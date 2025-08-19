# Connecting the Dots

An interactive React app for reading PDFs, exploring document structure, and asking AI questions about your files. It includes a custom PDF viewer, a sidebar **Table of Contents** and **Files** list, and optional **podcast generation** from selected text via a Flask backend.

## Tech Stack

- **React (Create React App)** with `react-scripts`
- **Tailwind CSS** (`tailwindcss`, `postcss`, `autoprefixer`)
- **PDF**: `react-pdf`, `pdfjs-dist`
- **UI**: `lucide-react`, `framer-motion`
- **Backend (optional)**: Flask API proxied at `http://localhost:4000`

## Repo Layout (high level)
.
├─ backend/                     # Flask API (RAG, podcast endpoints)
│  ├─ requirements.txt
│  └─ .env                      # backend secrets (see below)
├─ public/
├─ src/
│  ├─ components/
│  │  ├─ Toolbar.jsx
│  │  ├─ Tabs.jsx
│  │  ├─ ChatPanel.jsx
│  │  └─ viewer/
│  │     ├─ PDFPage.jsx
│  │     ├─ CenterViewer.jsx
│  │     ├─ selection.css
│  │     └─ scrollbar.css
│  ├─ services/
│  │  └─ api.js                 # API_BASE, client helpers
│  └─ App.jsx
├─ package.json                 # includes: “proxy”: “http://localhost:4000”
├─ tailwind.config.js
├─ postcss.config.js
└─ README.md
> Your tree may have more files; the list above reflects the parts most people touch.

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **Python** 3.10+ (for the backend)
- **ffmpeg** (only if you plan to post-process audio files for podcasts)

## Quick Start

### 1) Backend (Flask API on :4000)

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate

pip install -r requirements.txt
# create .env (see below)
python run.py          # or: flask run -p 4000
.env (example):

# RAG / LLM
OPENAI_API_KEY=sk-...
# add other provider keys as needed

# Azure Text-to-Speech (podcast)
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=centralindia


Endpoints expected by the frontend
	•	POST /api/rag/query → body: { "q": "...", "top_k": 6 }
	•	POST /api/podcast/from-selection → body: { "selection": "...", "top_k": 5, "minutes": 2.5, "voiceA": "en-IN-NeerjaNeural", "voiceB": "en-IN-PrabhatNeural", "rate": "-2%", "pitch": "0st" }

The frontend is configured with "proxy": "http://localhost:4000" in package.json, so /api/* calls are forwarded automatically in development.


2) Frontend (React + Tailwind on :3000)
npm install
npm start
Open http://localhost:3000.

Available Scripts

From the project root:
	•	npm start – run the frontend dev server (http://localhost:3000)
	•	npm test – run tests with React Testing Library
	•	npm run build – production build to build/
	•	npm run eject – one-way eject from CRA (not recommended unless needed)

Tailwind Setup

Already configured:
	•	tailwind.config.js scans ./src/**/*.{js,jsx,ts,tsx}
	•	postcss.config.js loads tailwindcss and autoprefixer

Make sure your global CSS imports Tailwind layers:
@tailwind base;
@tailwind components;
@tailwind utilities;

PDF Viewer Notes
	•	Uses react-pdf with pdfjs-dist.
	•	Ensure the worker matches the installed pdf.js version:
import { pdfjs } from "react-pdf";
const v = pdfjs.version;
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${v}/build/pdf.worker.min.mjs`;


Features One can Touch Most
	•	Toolbar: toggle pan/draw/select modes, zoom/rotate, and a color palette for pencil/highlighter.
	•	Viewer: page virtualization, smooth zoom/pan, and a non-selectable drawing layer while the pencil is active.
	•	Sidebar:
	•	Table of Contents: H1/H2/H3 tree (DocLayout-YOLO output if integrated).
	•	Files: quick switch between multiple uploaded PDFs.
	•	ChatPanel: Ask questions about the current document using /api/rag/query.
	•	Podcast: Select text → POST to /api/podcast/from-selection → play/download.
    •   Insights: Provides necessary ideas about the highlighted text
    
Troubleshooting
	•	PDF worker / blank pages
Double-check the worker URL and pdfjs-dist version.
	•	IntersectionObserver: parameter 1 is not of type ‘Element’
Only observe when the ref is non-null:
if (nodeRef?.current instanceof Element) observer.observe(nodeRef.current);


•	Text gets selected while drawing
Apply user-select: none; on the drawing layer container and toggle it when draw mode is active (e.g., by adding/removing a class on <body>).
•	Accidentally put CSS inside a .jsx
Keep CSS rules in .css files and import them from components. CRA will throw parser errors if CSS appears in JS/JSX.

Configuration Tips
•	Backend port different than 4000?
Update the frontend "proxy" in package.json or set API_BASE in src/services/api.js.
•	For CRA, any env exposed to the browser must start with REACT_APP_.