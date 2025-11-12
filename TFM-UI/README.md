# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

---

## TFM-UI - Project notes & Docker

Additional instructions for this TFM frontend (React + Vite + Tailwind):

- Run development server:
	- Open a terminal in `frontend/TFM-UI`
	- Install deps: `npm ci`
	- Start dev server: `npm run dev`
	- App will be available at http://localhost:5173 by default

- Backend dev (FastAPI):
	- From the repo root open a terminal in `API`
	- Install dependencies in a Python env and run: `uvicorn main:app --reload --port 8000`
	- The Vite dev server proxies `/predict` to `http://localhost:8000` in development

- Build & run the frontend as a static site (Docker):
	- From `frontend/TFM-UI` you can build a production image using the included `Dockerfile`.
	- Example (PowerShell):
		- `docker build -t tfm-ui:latest .`
		- `docker run -p 8080:80 tfm-ui:latest`
	- The container serves the static build via nginx on port 80 inside the container.

- Notes about error handling and security:
	- The backend logs full tracebacks server-side but returns a generic `{"error":"Internal server error"}` to clients to avoid leaking internals.
	- The frontend coerces CSV/Excel row values to strings before sending requests because the FastAPI Pydantic model expects string fields.

If you'd like, I can add a `docker-compose.yml` that builds and runs both the API and the UI together, or update this README with more detailed build steps.
