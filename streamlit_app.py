import streamlit as st
import pandas as pd
import requests
import io

# Config
st.set_page_config(page_title="TFM - Batch Predictor", layout="wide")

API_BASE = st.text_input("API base URL", value="https://tfm-1-1sle.onrender.com", help="Base URL donde está desplegada la API (sin slash final)")

st.title("Batch prediction desde Excel")
st.write("Sube un archivo Excel (o CSV). La app llamará a los endpoints de la API para cada fila y devolverá las predicciones y probabilidades.")

uploaded = st.file_uploader("Sube un archivo (.xlsx, .xls, .csv)", type=["xlsx", "xls", "csv"]) 
if not uploaded:
    st.info("Sube un archivo para comenzar")
    st.stop()

@st.cache_data
def read_file(f):
    if str(f.name).lower().endswith(('.xls', '.xlsx')):
        return pd.read_excel(f)
    else:
        return pd.read_csv(f)

df = read_file(uploaded)
st.write(f"Dataframe cargado — filas: {df.shape[0]}, columnas: {df.shape[1]}")
st.dataframe(df.head())

# Campos esperados por el API (según InputData en main.py)
REQUIRED_FIELDS = [
    "Grupo_de_Edad","Localidad","Cat_Fisica","Cat_Visual","Cat_Auditiva","Cat_Intelectual",
    "Cat_Psicosocial","Cat_Sordoceguera","Cat_Multiple","Congnicion","Movilidad","Cuidado_Personal",
    "Relaciones","Actividades_vida_diaria","Global","CausaDeficiencia","IdentidaddeAcuerdoconCostumbres",
    "IdentidaddeGenero","OrientacionSexual","HaEstadoProcesosdeRehabilitacion","AsisteaRehabilitacion",
    "SuMunicipioTieneServiciodeRehabilitacion","UtilizaProductosApoyo","LeeyEscribe","Trabaja","FuenteIngresos",
    "IngresoMensualPromedio","PerteneceaOrganizacionMovimiento","TomadeDecisiones","RequiereAyudadeOtraPersona",
    "UstedVive","BarrerasFisicas"
]

missing = [c for c in REQUIRED_FIELDS if c not in df.columns]
if missing:
    st.warning(f"Faltan columnas esperadas en el archivo: {missing}. Se crearán con valores vacíos por defecto.")
    for m in missing:
        df[m] = ""

endpoints = {
    'causa': f"{API_BASE}/predict/causa",
    'asiste': f"{API_BASE}/predict/asiste",
    'nivel': f"{API_BASE}/predict/nivel",
}

if st.button("Ejecutar predicciones para todo el archivo"):
    results = []
    progress = st.progress(0)
    total = len(df)
    for i, row in df.iterrows():
        payload = {k: (row[k] if pd.notna(row[k]) else "") for k in REQUIRED_FIELDS}
        row_result = {}
        for name, url in endpoints.items():
            try:
                r = requests.post(url, json=payload, timeout=30)
                if r.status_code == 200:
                    data = r.json()
                    pred = data.get('prediccion') or data.get('prediction') or ''
                    proba = data.get('probabilidad') or data.get('probability') or None
                else:
                    pred = ''
                    proba = None
                row_result[f'pred_{name}'] = pred
                row_result[f'prob_{name}'] = proba
            except Exception as e:
                row_result[f'pred_{name}'] = ''
                row_result[f'prob_{name}'] = None
        # Determine which endpoint returned highest probability (if any)
        probs = {k: v for k, v in row_result.items() if k.startswith('prob_')}
        best = None
        best_val = -1
        for k, v in probs.items():
            try:
                val = float(v) if v is not None else -1
            except Exception:
                val = -1
            if val > best_val:
                best_val = val
                best = k.replace('prob_', '')
        row_result['top_endpoint'] = best
        row_result['top_prob'] = best_val if best is not None else None
        results.append(row_result)
        progress.progress(int((i+1)/total*100))

    # Merge results into DataFrame
    res_df = pd.concat([df.reset_index(drop=True), pd.DataFrame(results)], axis=1)
    st.success("Predicciones completadas")
    st.dataframe(res_df.head(50))

    # Descargar como Excel
    tosave = io.BytesIO()
    with pd.ExcelWriter(tosave, engine='openpyxl') as writer:
        res_df.to_excel(writer, index=False, sheet_name='predictions')
    tosave.seek(0)
    st.download_button("Descargar resultados (.xlsx)", data=tosave, file_name='predictions.xlsx')
