import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import axios from "axios";
import pLimit from "p-limit";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

import "./App.css";
import researchingSvg from "./assets/undraw_researching_49yy.svg";

function toPercent2(prob01) {
  const p = Number(prob01);
  if (!Number.isFinite(p)) return "-";
  return `${(p * 100).toFixed(2)}%`;
}

function getScoreBg(prob01) {
  const p = Number(prob01);
  if (!Number.isFinite(p)) return "#f59e0b"; // naranja por defecto
  if (p >= 0.8) return "#078f56ff"; // verde
  if (p <= 0.2) return "#a81919dc"; // rojo
  return "#b17308ea"; // naranja
}

function getBestPerEndpoint(results, endpoint) {
  // endpoint: "asiste" | "causa" | "nivel"
  if (!Array.isArray(results) || results.length === 0) return null;
  const predKey = `pred_${endpoint}`;
  const probKey = `prob_${endpoint}`;

  let best = null;
  for (let i = 0; i < results.length; i++) {
    const r = results[i] || {};
    const pred = (r[predKey] ?? "").toString().trim();
    const prob = Number(r[probKey]);

    // si no hay predicción, no lo consideramos
    if (!pred) continue;

    if (!best) best = { endpoint, pred, prob, idx: i };
    else {
      const bestProb = Number(best.prob);
      if (!Number.isFinite(bestProb) && Number.isFinite(prob)) {
        best = { endpoint, pred, prob, idx: i };
      } else if (Number.isFinite(prob) && prob > bestProb) {
        best = { endpoint, pred, prob, idx: i };
      }
    }
  }
  return best;
}

export default function App() {
  const [fileName, setFileName] = useState(null);
  const [rows, setRows] = useState([]);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileObj, setFileObj] = useState(null);
  const fileInputRef = useRef(null);
  const [toast, setToast] = useState({ show: false, text: "", type: "info" });

  const [colsModalOpen, setColsModalOpen] = useState(false);

  const [resultsModalOpen, setResultsModalOpen] = useState(false);

  function showToast(text, type = "info", ms = 4000) {
    setToast({ show: true, text, type });
    setTimeout(() => setToast({ show: false, text: "", type }), ms);
  }

  const requiredFields = [
    "Grupo_de_Edad",
    "Localidad",
    "Cat_Fisica",
    "Cat_Visual",
    "Cat_Auditiva",
    "Cat_Intelectual",
    "Cat_Psicosocial",
    "Cat_Sordoceguera",
    "Cat_Multiple",
    "Congnicion",
    "Movilidad",
    "Cuidado_Personal",
    "Relaciones",
    "Actividades_vida_diaria",
    "Global",
    "CausaDeficiencia",
    "IdentidaddeAcuerdoconCostumbres",
    "IdentidaddeGenero",
    "OrientacionSexual",
    "HaEstadoProcesosdeRehabilitacion",
    "AsisteaRehabilitacion",
    "SuMunicipioTieneServiciodeRehabilitacion",
    "UtilizaProductosApoyo",
    "LeeyEscribe",
    "Trabaja",
    "FuenteIngresos",
    "IngresoMensualPromedio",
    "PerteneceaOrganizacionMovimiento",
    "TomadeDecisiones",
    "RequiereAyudadeOtraPersona",
    "UstedVive",
    "BarrerasFisicas",
  ];

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target.result;
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: "" });

      const filled = json.map((r) => {
        const obj = { ...r };
        requiredFields.forEach((f) => {
          if (!(f in obj)) obj[f] = "";
        });
        return obj;
      });

      setFileName(file.name);
      setFileObj(file);
      setRows(filled);
      setResults([]);
      setProgress(0);
    };
    reader.readAsArrayBuffer(file);
  }

  async function runPredictions() {
    setRunning(true);
    setResults([]);
    setProgress(0);

    const BASE_URL = "http://jw00ccw4occ0sggc88884skc.217.216.91.112.sslip.io";
    const endpoints = {
      causa: `${BASE_URL}/predict/causa`,
      asiste: `${BASE_URL}/predict/asiste`,
      nivel: `${BASE_URL}/predict/nivel`,
    };

    const limit = pLimit(5);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const payload = {};
      Object.keys(row).forEach((k) => {
        const v = row[k];
        if (v === null || v === undefined) payload[k] = "";
        else payload[k] = typeof v === "string" ? v : String(v);
      });

      const tasks = Object.entries(endpoints).map(([name, url]) =>
        limit(() =>
          axios
            .post(url, payload, { timeout: 30000 })
            .then((r) => ({ name, data: r.data })),
        ),
      );

      let res;
      try {
        res = await Promise.all(tasks);
      } catch (e) {
        console.error("Error during prediction requests:", e);
        const resp = e?.response;
        if (resp) {
          const status = resp.status;
          let body = resp.data;
          try {
            if (body instanceof Blob && typeof body.text === "function") {
              body = await body.text();
            } else if (typeof body === "object") {
              body = JSON.stringify(body);
            }
          } catch (ex) {
            console.error("Failed to read error body", ex);
          }
          showToast(
            `Error ${status} from server: ${body || "[no body]"}`,
            "error",
          );
        } else {
          showToast(
            `Network/error while predicting: ${e.message || e}`,
            "error",
          );
        }
        setRunning(false);
        return;
      }

      const rowResult = {};
      res.forEach((r) => {
        if (r && r.data) {
          rowResult[`pred_${r.name}`] =
            r.data.prediccion ?? r.data.prediction ?? "";
          rowResult[`prob_${r.name}`] =
            r.data.probabilidad ?? r.data.probability ?? null;
        } else {
          rowResult[`pred_${r.name}`] = "";
          rowResult[`prob_${r.name}`] = null;
        }
      });

      setResults((prev) => [...prev, rowResult]);
      setProgress(Math.round(((i + 1) / rows.length) * 100));
    }

    setRunning(false);
    setProgress(100);
    setResultsModalOpen(true);
  }

  React.useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") {
        setColsModalOpen(false);
        setResultsModalOpen(false);
      }
    }
    if (colsModalOpen || resultsModalOpen)
      window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [colsModalOpen, resultsModalOpen]);

  const bestAsiste = getBestPerEndpoint(results, "asiste");
  const bestCausa = getBestPerEndpoint(results, "causa");
  const bestNivel = getBestPerEndpoint(results, "nivel");

  const ResultCard = ({ title, item }) => {
    const bg = getScoreBg(item?.prob);
    return (
      <div
        style={{
          borderRadius: "14px",
          padding: "14px",
          color: "white",
          background: bg,
          boxShadow: "0 10px 28px rgba(0,0,0,0.15)",
          display: "grid",
          gap: "6px",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: "1.05rem" }}>{title}</div>

        <div style={{ fontSize: "0.9rem", opacity: 0.95 }}>
          <strong>Predicción:</strong>{" "}
          <span style={{ fontWeight: 900 }}>
            {item?.pred ? item.pred : "(sin predicción)"}
          </span>
        </div>

        <div style={{ fontSize: "0.9rem", opacity: 0.95 }}>
          <strong>Fiabilidad:</strong>{" "}
          <span style={{ fontWeight: 900 }}>{toPercent2(item?.prob)}</span>
        </div>
      </div>
    );
  };

  return (
    <div
      className="flex items-center flex-col min-h-screen w-full"
      style={{ background: "#6f7ba0ff", padding: "2rem" }}
    >
      <h1
        style={{
          fontSize: "2.875rem",
          fontWeight: "bold",
          color: "white",
          marginBottom: "1.5rem",
          textAlign: "center",
          width: "70%",
        }}
      >
        Herramienta web inteligente de predicción del acceso a la educación
        inclusiva en Bogotá
      </h1>

      <Card
        style={{
          maxWidth: "56rem",
          background: "white",
          color: "#222",
          boxShadow: "0 4px 24px 0 rgba(0,0,0,0.08)",
          borderRadius: "0.75rem",
        }}
      >
        <CardContent style={{ padding: "2.5rem" }}>
          <div className="mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>
                  <div
                    style={{
                      color: "#6c63ff",
                      fontSize: "2rem",
                      fontWeight: "bold",
                    }}
                  >
                    ¿Cómo usar la herramienta y qué hace?
                  </div>
                </CardTitle>
              </CardHeader>

              <CardContent className="text-sm text-neutral-800 leading-relaxed">
                <div className="w-full flex justify-center border-b border-neutral-200 bg-white p-4">
                  <img
                    src={researchingSvg}
                    alt="Ilustración de análisis y predicción"
                    className="h-40 w-auto sm:h-44"
                  />
                </div>

                <p className="mb-3">
                  Esta herramienta permite{" "}
                  <strong>cargar un archivo Excel o CSV</strong> con registros
                  de personas con discapacidad y generar, de forma automática,
                  predicciones que apoyan la toma de decisiones en educación
                  inclusiva.
                </p>

                <p className="mb-3">
                  Al ejecutar vas a tener los siguientes respuestas
                </p>

                <ul className="list-disc pl-5 space-y-1 mb-3">
                  <li>
                    <strong>Asiste a institución educativa</strong>: estima si
                    la persona asiste actualmente a una institución educativa.
                  </li>
                  <li>
                    <strong>
                      Causa por la que no asiste o no asistiría a institución
                      educativa
                    </strong>
                    : sugiere la causa más probable por la cual una persona no
                    estudia.
                  </li>
                  <li>
                    <strong>Nivel educativo alcanzado</strong>: estima el nivel
                    educativo asociado/requerido según el perfil.
                  </li>
                </ul>

                <p className="mb-3">
                  El resultado se muestra con su probabilidad. La herramienta
                  está pensada como un apoyo para análisis y priorización
                  institucional; no reemplaza la valoración profesional.
                </p>

                <p className="text-xs text-neutral-600">
                  Nota: asegúrate de que tu archivo contenga las columnas
                  requeridas (si faltan, el sistema las completa con valores
                  vacíos para mantener la estructura esperada).{" "}
                  <button
                    type="button"
                    onClick={() => setColsModalOpen(true)}
                    style={{
                      color: "#6c63ff",
                      textDecoration: "underline",
                      fontWeight: 600,
                      cursor: "pointer",
                      background: "transparent",
                      border: "none",
                      padding: 0,
                    }}
                  >
                    Ver columnas requeridas
                  </button>
                  .
                </p>
              </CardContent>
            </Card>
          </div>

          <div
            style={{
              background: "#6c63ff",
              borderRadius: "10px",
              color: "white",
              padding: "1.5rem",
            }}
          >
            <div className="mb-4">
              <Label>
                Sube tu archivo (.xlsx/.csv) y usa los botones para ejecutar
                predicciones y ver los resultados.
              </Label>
            </div>

            <div style={{ width: "100%", marginTop: "1rem" }}>
              <input
                ref={fileInputRef}
                id="fileInput"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0])
                    readFile(e.target.files[0]);
                }}
                className="hidden"
              />

              <div>
                <Button
                  onClick={() => {
                    const el =
                      fileInputRef?.current ||
                      document.getElementById("fileInput");
                    if (el) el.click();
                    else console.warn("file input not found");
                  }}
                  style={
                    fileName
                      ? {
                          background: "#6c63ff",
                          color: "white",
                          fontWeight: "bold",
                          border: "1px solid white",
                        }
                      : {
                          background: "white",
                          color: "#6c63ff",
                          fontWeight: "bold",
                        }
                  }
                >
                  {fileName ? "Cambiar archivo" : "Subir archivo"}
                </Button>

                {fileName && (
                  <div style={{ color: "whitesmoke", marginTop: "1rem" }}>
                    <span style={{ fontWeight: "bold" }}>
                      Nombre de archivo subido:
                    </span>{" "}
                    {fileName}
                  </div>
                )}

                {fileName && (
                  <div>
                    <strong>Filas cargadas:</strong> {rows.length}
                  </div>
                )}

                {fileName && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      marginTop: "1rem",
                      width: "100%",
                      justifyContent: "center",
                    }}
                  >
                    <Button
                      onClick={runPredictions}
                      disabled={running}
                      style={
                        running
                          ? {
                              background: "grey",
                              color: "white",
                              fontWeight: "bold",
                              pointerEvents: "none",
                            }
                          : {
                              background: "white",
                              color: "#6c63ff",
                              fontWeight: "bold",
                            }
                      }
                    >
                      {running ? "Ejecutando..." : "Ejecutar predicciones"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {rows.length > 0 && (
            <>
              <div style={{ marginTop: "1.5rem" }}>
                <Label>Progreso: {progress}%</Label>
                <Progress value={progress} className="mt-2" />
              </div>

              {results.length > 0 && progress === 100 && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    marginTop: "14px",
                  }}
                >
                  <Button
                    type="button"
                    onClick={() => setResultsModalOpen(true)}
                    style={{
                      background: "white",
                      color: "#6c63ff",
                      fontWeight: "bold",
                    }}
                  >
                    Ver resultados
                  </Button>
                </div>
              )}
            </>
          )}

          {/* ✅ MODAL columnas requeridas */}
          {colsModalOpen && (
            <div
              role="dialog"
              aria-modal="true"
              onClick={() => setColsModalOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                zIndex: 9999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "1rem",
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "min(720px, 95vw)",
                  background: "white",
                  borderRadius: "12px",
                  boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "16px 18px",
                    borderBottom: "1px solid #e5e7eb",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: "1.05rem",
                        fontWeight: 800,
                        color: "#111827",
                      }}
                    >
                      Columnas requeridas del archivo
                    </div>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: "#6b7280",
                        marginTop: "4px",
                      }}
                    >
                      Si alguna columna falta, se completará vacía para mantener
                      la estructura.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setColsModalOpen(false)}
                    aria-label="Cerrar"
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: "999px",
                      padding: "6px 10px",
                      cursor: "pointer",
                      background: "white",
                      fontWeight: 700,
                    }}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ padding: "14px 18px" }}>
                  <div
                    style={{
                      maxHeight: "55vh",
                      overflow: "auto",
                      border: "1px solid #e5e7eb",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      background: "#fafafa",
                    }}
                  >
                    <ol
                      style={{
                        margin: 0,
                        paddingLeft: "1.25rem",
                        lineHeight: 1.55,
                      }}
                    >
                      {requiredFields.map((c) => (
                        <li
                          key={c}
                          style={{
                            padding: "4px 0",
                            color: "#111827",
                            fontSize: "0.9rem",
                          }}
                        >
                          <code
                            style={{
                              fontSize: "0.82rem",
                              background: "white",
                              border: "1px solid #e5e7eb",
                              padding: "2px 6px",
                              borderRadius: "6px",
                            }}
                          >
                            {c}
                          </code>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginTop: "12px",
                    }}
                  >
                    <Button
                      style={{
                        backgroundColor: "rgb(108, 99, 255)",
                        color: "white",
                        padding: "8px 16px",
                        borderRadius: "6px",
                      }}
                      type="button"
                      onClick={() => setColsModalOpen(false)}
                    >
                      Cerrar
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {resultsModalOpen && (
            <div
              role="dialog"
              aria-modal="true"
              onClick={() => setResultsModalOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                zIndex: 9999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "1rem",
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "min(860px, 96vw)",
                  background: "white",
                  borderRadius: "12px",
                  boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "16px 18px",
                    borderBottom: "1px solid #e5e7eb",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: "1.05rem",
                        fontWeight: 900,
                        color: "#111827",
                      }}
                    >
                      Resultados
                    </div>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: "#6b7280",
                        marginTop: "4px",
                      }}
                    >
                      Se muestra la predicción para las variables.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setResultsModalOpen(false)}
                    aria-label="Cerrar"
                    style={{
                      border: "1px solid #2a69e6ff",
                      borderRadius: "999px",
                      padding: "6px 10px",
                      cursor: "pointer",
                      background: "white",
                      fontWeight: 800,
                      color: "#2a69e6ff",
                    }}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ padding: "14px 18px" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(1, 1fr)",
                      gap: "12px",
                    }}
                  >
                    <ResultCard
                      title="Asiste a institución educativa"
                      item={bestAsiste}
                    />
                    <ResultCard
                      title="Causa por la que no asiste o no asistiría a institución educativa"
                      item={bestCausa}
                    />
                    <ResultCard
                      title="Nivel educativo alcanzado"
                      item={bestNivel}
                    />
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginTop: "14px",
                    }}
                  >
                    <Button
                      style={{
                        backgroundColor: "rgb(108, 99, 255)",
                        color: "white",
                        padding: "8px 16px",
                        borderRadius: "6px",
                      }}
                      type="button"
                      onClick={() => setResultsModalOpen(false)}
                    >
                      Cerrar
                    </Button>
                  </div>

                  <div
                    style={{
                      marginTop: "10px",
                      color: "#6b7280",
                      fontSize: "0.85rem",
                    }}
                  >
                    Regla de color: <strong>&gt;= 80%</strong> verde,{" "}
                    <strong>&lt;= 20%</strong> rojo, en otro caso naranja.
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Toast */}
      {toast.show && (
        <div
          className={`fixed top-6 right-6 z-50 max-w-sm rounded shadow-lg px-4 py-2 text-white ${
            toast.type === "error"
              ? "bg-red-600"
              : toast.type === "success"
                ? "bg-green-600"
                : "bg-sky-600"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
