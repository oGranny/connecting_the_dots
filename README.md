# Connecting the Dots
[![React](https://img.shields.io/badge/React-18+-61DAFB?style=flat-square&logo=react&logoColor=white)](https://reactjs.org/) [![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org/) [![Flask](https://img.shields.io/badge/Flask-2.3+-000000?style=flat-square&logo=flask&logoColor=white)](https://flask.palletsprojects.com/) [![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docker.com/)

## 🚀 Revolutionary PDF Analysis Platform

**Transform how you interact with documents** using cutting-edge AI technology. This platform combines advanced document analysis, AI-powered insights, and interactive features to deliver an unparalleled PDF exploration experience. Upload PDFs, navigate through intelligent table of contents, ask AI questions using RAG (Retrieval-Augmented Generation), and generate podcasts from selected text—all in one powerful, seamless interface.

> 🔥 **Built for the future of document intelligence** - leveraging state-of-the-art AI to unlock hidden insights in your PDFs.

## 🎬 Demo

[![Demo Video](https://img.shields.io/badge/▶️_Watch_Demo-blue?style=for-the-badge)](https://drive.google.com/drive/folders/1wBwBbH747e5jldWefSUI5zQsqZ6hRqGB?usp=sharing)

> 🎥 **[Click here to watch our demo video](https://drive.google.com/drive/folders/1wBwBbH747e5jldWefSUI5zQsqZ6hRqGB?usp=sharing)** showcasing all the key features in action.

## ⚡ Game-Changing Features

- 🔍 **Smart PDF Viewer**: Pan, zoom, rotate, annotate with professional drawing tools
- 🤖 **AI-Powered Chat**: Ask complex questions about your documents using advanced RAG
- 🎧 **Podcast Generation**: Convert selected text into engaging conversational audio
- 📚 **Intelligent TOC**: Auto-generated table of contents using YOLO-based layout detection
- 💡 **Context-Aware Insights**: Get intelligent analysis of highlighted content
- 📁 **Multi-Document Management**: Switch between multiple uploaded PDFs seamlessly
- 🎨 **Rich Annotations**: Draw, highlight, and markup documents with customizable tools

## 🛠 Cutting-Edge Tech Stack

### Frontend
- **React 18+** (Create React App)
- **Tailwind CSS** for modern styling
- **Lucide React** for icons
- **react-pdf & pdfjs-dist** for PDF rendering

### Backend
- **Flask** (Python 3.10+)
- **Advanced RAG Implementation** with vector embeddings
- **Azure OpenAI Text-to-Speech** for podcast generation
- **Custom YOLO** for document layout detection
- **OpenAI/LLM integration** for AI features
- **Custom hybrid RAG + SLM-LLM pipeline** for accurate responses

## 🔄 Intelligent Workflow

- **📤 Upload PDF** → File is stored in the backend, indexed into the RAG database, and a small language model (SLM) extracts Top-K relevant sections.  
- **🎯 Anchor Text** → When a user selects text in the PDF, a RAG query fetches Top-K matching contexts, which are passed to the LLM (RAG) to generate an answer.  
- **🎙️ Generate Podcast** → On podcast click, the Top-K contexts are fed into an LLM with a podcast prompt, and the script is converted into audio using Azure OpenAI TTS.  
- **💬 Chat** → User queries trigger a RAG search; if confidence ≥ threshold, the answer comes from the RAG LLM; otherwise, a precomputed summary of all PDFs is given to a general LLM for a fallback response.  

### 🏗️ Architecture
![Architecture Diagram](https://drive.google.com/uc?id=16pOxHoDP6niXLiSet7E0f9mq78-ow3Dy)

## 📁 Project Structure

```text
connecting_the_dots/
├── Dockerfile
├── README.md
├── docker-compose.yml
├── nginx.conf
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── entrypoint.sh
│
├── backend/
│   ├── app/
│   │   ├── routes/
│   │   │   ├── analyze_api.py
│   │   │   ├── outline_api.py
│   │   │   ├── podcast_api.py
│   │   │   ├── rag_api.py
│   │   │   ├── pdf_ops.py
│   │   │   ├── health.py
│   │   │   └── uploads.py
│   │   ├── services/
│   │   │   ├── genai_service.py
│   │   │   ├── pdf_service.py
│   │   │   └── rag_service.py
│   │   ├── __init__.py
│   │   └── config.py
│   ├── model/
│   │   ├── model.pt
│   │   └── outline_yolo.py
│   ├── rag_index/
│   ├── uploads/
│   ├── myvenv/
│   ├── .env
│   ├── app.py
│   ├── requirements.txt
│   └── run.py
│
├── public/
│   ├── favicon.ico
│   ├── index.html
│   ├── logo192.png
│   ├── logo512.png
│   ├── manifest.json
│   └── robots.txt
│
└── src/
  ├── components/
  │   ├── Toolbar.jsx
  │   ├── Tabs.jsx
  │   ├── ChatPanel.jsx
  │   └── viewer/
  │       ├── PDFPage.jsx
  │       ├── CenterViewer.jsx
  │       ├── selection.css
  │       └── scrollbar.css
  ├── services/
  │   └── api.js
  ├── App.jsx
  └── index.js
```

## 🚀 Quick Start

> **⚠️ CRITICAL:** Port `4000` (backend API) must be exposed when running the Docker image. The frontend runs on `8080`. Make sure both ports are mapped.

### Option 1 — Docker

**Build**
```bash
docker build --platform linux/amd64 -t connectin-the-dots .
```

**Run**
```bash
docker run -e LLM_PROVIDER=gemini -e GEMINI_MODEL=gemini-2.5 -e TTS_PROVIDER=azure -e GOOGLE_API_KEY=<GOOGLE_API_KEY> -e AZURE_TTS_KEY=<AZURE_TTS_KEY> -e AZURE_TTS_ENDPOINT=<AZURE_TTS_ENDPOINT> -p 8080:8080 -p 4000:4000 connecting_the_dots
```

#### Manual Setup (Development)

If your backend needs cloud credentials or API keys, create environment variables or use .env in `backend` folder:
```bash
cd backend/
python -m venv .venv
source ./.venv/bin/activate

pip install -r requirements.txt

python run.py

# Open a new terminal in the root of project directory and run:
npm install
npm start
```

**Health Check:**
```bash
curl http://localhost:4000/api/health
```

**Frontend:**
```bash
# From repo root
npm install
npm start
```

**🔑 Environment Variables:**
```bash
LLM_PROVIDER=gemini
GEMINI_MODEL=gemini-2.5-flash
TTS_PROVIDER=azure
AZURE_TTS_KEY=...
AZURE_TTS_ENDPOINT=...
GOOGLE_API_KEY=...
```

## 🛟 Troubleshooting

### Port Already in Use
```bash
Bind for 0.0.0.0:3000 failed
```
Stop anything on that port or change your mapping:
```bash
-p 8080:8080
```

### "Heading detection failed (check backend)" in the viewer
Make sure the backend endpoints are reachable and healthy:
```bash
curl http://localhost:8080/api/health
```

### **PDFs not opening or showing "failed to fetch"**

**Clear your browser's local storage:**
1. Open Chrome Developer Tools (F12)
2. Go to the **Application** tab
3. In the left sidebar, expand **Local Storage**
4. Select your domain and clear all entries
5. Refresh the page and try uploading the PDF again