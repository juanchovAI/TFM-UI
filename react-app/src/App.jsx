import React, { useState } from 'react'
import * as XLSX from 'xlsx'
import axios from 'axios'
import pLimit from 'p-limit'

export default function App() {
  const [apiBase, setApiBase] = useState(import.meta.env.VITE_API_BASE || '')
  const [fileName, setFileName] = useState(null)
  const [rows, setRows] = useState([])
  const [results, setResults] = useState([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [apiKey, setApiKey] = useState('')
  const [fileObj, setFileObj] = useState(null)

  const requiredFields = [
    "Grupo_de_Edad","Localidad","Cat_Fisica","Cat_Visual","Cat_Auditiva","Cat_Intelectual",
    "Cat_Psicosocial","Cat_Sordoceguera","Cat_Multiple","Congnicion","Movilidad","Cuidado_Personal",
    "Relaciones","Actividades_vida_diaria","Global","CausaDeficiencia","IdentidaddeAcuerdoconCostumbres",
    "IdentidaddeGenero","OrientacionSexual","HaEstadoProcesosdeRehabilitacion","AsisteaRehabilitacion",
    "SuMunicipioTieneServiciodeRehabilitacion","UtilizaProductosApoyo","LeeyEscribe","Trabaja","FuenteIngresos",
    "IngresoMensualPromedio","PerteneceaOrganizacionMovimiento","TomadeDecisiones","RequiereAyudadeOtraPersona",
    "UstedVive","BarrerasFisicas"
  ]

  function readFile(file) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const data = e.target.result
      const wb = XLSX.read(data, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json(ws, { defval: '' })
      setFileName(file.name)
      setFileObj(file)
      // ensure required fields exist
      const filled = json.map(r => {
        const obj = { ...r }
        requiredFields.forEach(f => { if (!(f in obj)) obj[f] = '' })
        return obj
      })
      setRows(filled)
    }
    reader.readAsArrayBuffer(file)
  }

  async function runPredictions() {
    if (!apiBase) { alert('Por favor indica API base URL'); return }
    setRunning(true)
    setResults([])
    setProgress(0)

    const endpoints = {
      causa: `${apiBase.replace(/\/$/, '')}/predict/causa`,
      asiste: `${apiBase.replace(/\/$/, '')}/predict/asiste`,
      nivel: `${apiBase.replace(/\/$/, '')}/predict/nivel`
    }

    const limit = pLimit(5) // concurrency
    const out = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const tasks = Object.entries(endpoints).map(([name, url]) => limit(async () => {
        try {
          const headers = {}
          if (apiKey) headers['x-api-key'] = apiKey
          const r = await axios.post(url, row, { timeout: 30000, headers })
          return { name, data: r.data }
        } catch (e) {
          return { name, data: null }
        }
      }))
      const res = await Promise.all(tasks)
      const rowResult = {}
      res.forEach(r => {
        if (r && r.data) {
          rowResult[`pred_${r.name}`] = r.data.prediccion ?? r.data.prediction ?? ''
          rowResult[`prob_${r.name}`] = r.data.probabilidad ?? r.data.probability ?? null
        } else {
          rowResult[`pred_${r.name}`] = ''
          rowResult[`prob_${r.name}`] = null
        }
      })
      // choose top
      const probs = ['prob_causa','prob_asiste','prob_nivel']
      let top = null
      let topVal = -1
      probs.forEach(p => {
        const v = parseFloat(rowResult[p])
        if (!isNaN(v) && v > topVal) { topVal = v; top = p.replace('prob_','') }
      })
      rowResult.top_endpoint = top
      rowResult.top_prob = topVal === -1 ? null : topVal
      out.push(rowResult)
      setResults(prev => [...prev, rowResult])
      setProgress(Math.round(((i+1)/rows.length)*100))
    }

    setRunning(false)
    setProgress(100)
  }

  function downloadResults() {
    const combined = rows.map((r, i) => ({ ...r, ...(results[i] || {}) }))
    const ws = XLSX.utils.json_to_sheet(combined)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'predictions')
    XLSX.writeFile(wb, `${fileName || 'predictions'}`)
  }

  async function runBatchOnServer() {
    if (!apiBase) { alert('Por favor indica API base URL'); return }
    if (!fileObj) { alert('Sube un archivo primero'); return }
    const url = `${apiBase.replace(/\/$/, '')}/predict/batch`
    const form = new FormData()
    form.append('file', fileObj, fileObj.name)
    try {
      const headers = { 'Content-Type': 'multipart/form-data' }
      if (apiKey) headers['x-api-key'] = apiKey
      const resp = await axios.post(url, form, { headers, responseType: 'blob', timeout: 0 })
      // download blob
      const blob = new Blob([resp.data], { type: resp.headers['content-type'] })
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      const cd = resp.headers['content-disposition'] || ''
      const match = cd.match(/filename="?(.*)"?$/)
      const fname = match ? match[1] : (fileName ? `predictions_${fileName}` : 'predictions.xlsx')
      a.download = fname
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(downloadUrl)
      alert('Batch completado. Archivo descargado.')
    } catch (e) {
      console.error(e)
      alert('Error al ejecutar batch en servidor')
    }
  }

  return (
    <div className="container">
      <h1>TFM - Batch Predictor (React)</h1>
      <div style={{marginBottom:12}}>
        <label>API base URL: </label>
        <input style={{width: '60%'}} value={apiBase} onChange={e=>setApiBase(e.target.value)} placeholder="https://tu-api.onrender.com" />
      </div>

      <div style={{marginBottom:12}}>
        <label>API Key (opcional): </label>
        <input style={{width: '40%'}} value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="x-api-key value" />
      </div>

      <div style={{marginBottom:12}}>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={e=>readFile(e.target.files[0])} />
        {fileName && <span style={{marginLeft:8}}>{fileName}</span>}
      </div>

      {rows.length > 0 && (
        <div>
          <p>Filas cargadas: {rows.length}</p>
          <button onClick={runPredictions} disabled={running}>Ejecutar predicciones (cliente)</button>
          <button onClick={runBatchOnServer} style={{marginLeft:8}} disabled={running}>Ejecutar en servidor (batch)</button>
          <button onClick={downloadResults} style={{marginLeft:8}} disabled={results.length===0}>Descargar resultados (cliente)</button>
          <div style={{marginTop:8}}>Progreso: {progress}%</div>
          <div style={{marginTop:12}}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Top endpoint</th>
                  <th>Top prob</th>
                  <th>pred_causa</th>
                  <th>prob_causa</th>
                  <th>pred_asiste</th>
                  <th>prob_asiste</th>
                  <th>pred_nivel</th>
                  <th>prob_nivel</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0,50).map((r, i) => (
                  <tr key={i}>
                    <td>{i+1}</td>
                    <td>{results[i]?.top_endpoint ?? ''}</td>
                    <td>{results[i]?.top_prob ?? ''}</td>
                    <td>{results[i]?.pred_causa ?? ''}</td>
                    <td>{results[i]?.prob_causa ?? ''}</td>
                    <td>{results[i]?.pred_asiste ?? ''}</td>
                    <td>{results[i]?.prob_asiste ?? ''}</td>
                    <td>{results[i]?.pred_nivel ?? ''}</td>
                    <td>{results[i]?.prob_nivel ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
