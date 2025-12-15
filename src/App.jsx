import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import axios from "axios";
import pLimit from "p-limit";

// Shadcn UI components (assumes project configured with shadcn and Tailwind)
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import "./App.css";
import researchingSvg from "./assets/undraw_researching_49yy.svg";

// Utilidad para mostrar solo los tres más populares y, si se repiten, solo el de mayor probabilidad
function getTopPopularResults(results) {
  if (!Array.isArray(results) || results.length === 0) return [];
  const freq = {};
  results.forEach((row, idx) => {
    ["pred_causa", "pred_asiste", "pred_nivel"].forEach((key) => {
      const val = row[key];
      if (val) {
        if (!freq[val]) freq[val] = [];
        freq[val].push({
          idx,
          prob: parseFloat(row[`prob_${key.split("_")[1]}`]) || 0,
          endpoint: key,
        });
      }
    });
  });
  const sorted = Object.entries(freq)
    .map(([name, arr]) => {
      const best = arr.reduce((a, b) => (a.prob > b.prob ? a : b));
      return {
        name,
        count: arr.length,
        best,
      };
    })
    .sort((a, b) => b.count - a.count);
  const top3 = sorted.slice(0, 3);
  return top3.map((item) => ({
    name: item.name,
    endpoint: item.best.endpoint,
    prob: item.best.prob,
    idx: item.best.idx,
  }));
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

  // ✅ Modal desde cero
  const [colsModalOpen, setColsModalOpen] = useState(false);

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

    const endpoints = {
      causa: `/predict/causa`,
      asiste: `/predict/asiste`,
      nivel: `/predict/nivel`,
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
            .then((r) => ({ name, data: r.data }))
        )
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
          showToast(`Error ${status} from server: ${body || "[no body]"}`, "error");
        } else {
          showToast(`Network/error while predicting: ${e.message || e}`, "error");
        }
        setRunning(false);
        return;
      }
      const rowResult = {};
      res.forEach((r) => {
        if (r && r.data) {
          rowResult[`pred_${r.name}`] = r.data.prediccion ?? r.data.prediction ?? "";
          rowResult[`prob_${r.name}`] = r.data.probabilidad ?? r.data.probability ?? null;
        } else {
          rowResult[`pred_${r.name}`] = "";
          rowResult[`prob_${r.name}`] = null;
        }
      });
      const probs = ["prob_causa", "prob_asiste", "prob_nivel"];
      let top = null;
      let topVal = -1;
      probs.forEach((p) => {
        const v = parseFloat(rowResult[p]);
        if (!isNaN(v) && v > topVal) {
          topVal = v;
          top = p.replace("prob_", "");
        }
      });
      rowResult.top_endpoint = top;
      rowResult.top_prob = topVal === -1 ? null : topVal;
      setResults((prev) => [...prev, rowResult]);
      setProgress(Math.round(((i + 1) / rows.length) * 100));
    }

    setRunning(false);
    setProgress(100);
  }

  // ✅ Cerrar modal con tecla ESC (sin librerías)
  React.useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") setColsModalOpen(false);
    }
    if (colsModalOpen) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [colsModalOpen]);

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
        Herramienta web inteligente de predicción del acceso a la educación inclusiva en Bogotá
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
                  <div style={{ color: "#6c63ff", fontSize: "2rem", fontWeight: "bold" }}>
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
                  Esta herramienta permite <strong>cargar un archivo Excel o CSV</strong> con registros
                  de personas con discapacidad y generar, de forma automática, predicciones que apoyan
                  la toma de decisiones en educación inclusiva.
                </p>

                <p className="mb-3">
                  Al ejecutar las predicciones, el sistema consulta tres servicios (endpoints) y devuelve:
                </p>

                <ul className="list-disc pl-5 space-y-1 mb-3">
                  <li>
                    <strong>Asiste</strong>: estima si la persona asiste actualmente a una institución educativa.
                  </li>
                  <li>
                    <strong>Causa</strong>: sugiere la causa más probable por la cual una persona no estudia.
                  </li>
                  <li>
                    <strong>Nivel</strong>: estima el nivel educativo asociado/requerido según el perfil.
                  </li>
                </ul>

                <p className="mb-3">
                  El resultado se muestra con su probabilidad y un resumen de los resultados
                  más frecuentes. La herramienta está pensada como un apoyo para análisis y
                  priorización institucional; no reemplaza la valoración profesional.
                </p>

                {/* ✅ Nota + botón abre modal */}
                <p className="text-xs text-neutral-600">
                  Nota: asegúrate de que tu archivo contenga las columnas requeridas (si faltan, el sistema las completa
                  con valores vacíos para mantener la estructura esperada).{" "}
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

          <div style={{ background: "#6c63ff", borderRadius: "10px", color: "white", padding: "1.5rem" }}>
            <div className="mb-4">
              <Label>
                Sube tu archivo (.xlsx/.csv) y usa los botones para ejecutar predicciones y ver los resultados.
              </Label>
            </div>

            <div style={{ width: "100%", marginTop: "1rem" }}>
              <input
                ref={fileInputRef}
                id="fileInput"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  console.log("file input change", e.target.files);
                  if (e.target.files && e.target.files[0]) readFile(e.target.files[0]);
                }}
                className="hidden"
              />

              <div>
                <Button
                  onClick={() => {
                    const el = fileInputRef?.current || document.getElementById("fileInput");
                    if (el) el.click();
                    else console.warn("file input not found");
                  }}
                  style={
                    fileName
                      ? { background: "#6c63ff", color: "white", fontWeight: "bold", border: "1px solid white" }
                      : { background: "white", color: "#6c63ff", fontWeight: "bold" }
                  }
                >
                  {fileName ? "Cambiar archivo" : "Subir archivo"}
                </Button>

                {fileName && (
                  <div style={{ color: "whitesmoke", marginTop: "1rem" }}>
                    <span style={{ fontWeight: "bold" }}>Nombre de archivo subido:</span> {fileName}
                  </div>
                )}

                {fileName && (
                  <div>
                    <strong>Filas cargadas:</strong> {rows.length}
                  </div>
                )}

                {fileName && (
                  <div style={{ display: "flex", alignItems: "center", marginTop: "1rem", width: "100%", justifyContent: "center" }}>
                    <Button
                      onClick={runPredictions}
                      disabled={running}
                      style={
                        running
                          ? { background: "grey", color: "white", fontWeight: "bold", pointerEvents: "none" }
                          : { background: "white", color: "#6c63ff", fontWeight: "bold" }
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

              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variable</TableHead>
                      <TableHead>Predicción</TableHead>
                      <TableHead>Probabilidad</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {["asiste", "causa", "nivel"].map((endpoint) => {
                      const item = getTopPopularResults(results).find((r) => r.endpoint === `pred_${endpoint}`);
                      return (
                        <TableRow key={endpoint}>
                          <TableCell>{endpoint}</TableCell>
                          <TableCell>{item ? item.name : ""}</TableCell>
                          <TableCell>{item ? item.prob : ""}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          {/* ✅ MODAL DESDE CERO */}
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
                    <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#111827" }}>
                      Columnas requeridas del archivo
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "4px" }}>
                      Si alguna columna falta, se completará vacía para mantener la estructura.
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
                    <ol style={{ margin: 0, paddingLeft: "1.25rem", lineHeight: 1.55 }}>
                      {requiredFields.map((c) => (
                        <li key={c} style={{ padding: "4px 0", color: "#111827", fontSize: "0.9rem" }}>
                          <code style={{ fontSize: "0.82rem", background: "white", border: "1px solid #e5e7eb", padding: "2px 6px", borderRadius: "6px" }}>
                            {c}
                          </code>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
                    <Button style={{backgroundColor: "rgb(108, 99, 255)", color: "white", padding: "8px 16px", borderRadius: "6px"}} type="button" onClick={() => setColsModalOpen(false)}>
                      Cerrar
                    </Button>
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
