# TFM React Frontend

This is a minimal React (Vite) frontend to upload an Excel/CSV, call the three prediction endpoints (`/predict/causa`, `/predict/asiste`, `/predict/nivel`) for each row, and return results with the top endpoint per row.

Quick start

1. Install dependencies

```bash
cd frontend/react-app
npm ci
```

2. Run locally

```bash
npm run dev
# open http://localhost:5173
```

3. Build for production

```bash
npm run build
```

Environment

- The app reads `VITE_API_BASE` (or fill the API base URL in the UI). Example: `https://tfm-1-1sle.onrender.com`

Deploy to Amplify

1. Push this folder to GitHub (or use existing repo). In Amplify Console choose your repo and set the **Root directory** to `frontend/react-app`.
2. Amplify will detect front-end; confirm build settings (we included `amplify.yml`).
3. Set environment variable `VITE_API_BASE` in Amplify env variables (optional) or enter API base in the UI.

Notes

- For large files, consider implementing a server-side batch endpoint to avoid many client requests.
- Ensure CORS is enabled on the API (allow the Amplify domain).
