# Connecting the Dots

PDF exploration platform that combines advanced document analysis, AI-powered insights, and interactive features. Upload PDFs, navigate through smart table of contents, ask AI questions using RAG (Retrieval-Augmented Generation), and generate podcasts from selected text—all in one seamless interface.

## 🎬 Demo

Check out our demo: [Demo Video](https://drive.google.com/drive/folders/1wBwBbH747e5jldWefSUI5zQsqZ6hRqGB?usp=sharing)

## ✨ Key Features
- 🔍 Smart PDF Viewer: Pan, zoom, rotate, annotate with drawing tools
- 🤖 AI-Powered Chat: Ask questions about your documents using advanced RAG
- 🎧 Podcast Generation: Convert selected text into conversational audio
- 📚 Intelligent TOC: Auto-generated table of contents using YOLO-based layout detection
- 💡 Context-Aware Insights: Get smart analysis of highlighted content
- 📁 Multi-Document Management: Switch between multiple uploaded PDFs seamlessly
- 🎨 Rich Annotations: Draw, highlight, and markup documents with customizable tools

## 🛠 Tech Stack

### Frontend
- React 18+ (Create React App)
- Tailwind CSS for styling
- Lucide React for icons
- react-pdf & pdfjs-dist for PDF rendering

### Backend
- Flask (Python 3.10+)
- RAG Implementation with vector embeddings
- Azure OpenAI Text-to-Speech for podcast generation
- Custom YOLO for document layout detection
- OpenAI/LLM integration for AI features
- Custom pipeline using hybrid rag and slm-llm to generate accurate response.

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

### Option 1 — Docker (recommended)

**Build**
```bash
docker build --platform linux/amd64 -t connectin-the-dots .
```

**Run**
```bash
docker run -e LLM_PROVIDER=gemini -e GEMINI_MODEL=gemini-2.5 -e TTS_PROVIDER=azure -e GOOGLE_API_KEY=<GOOGLE_API_KEY> -e AZURE_TTS_KEY=<AZURE_TTS_KEY> -e AZURE_TTS_ENDPOINT=<AZURE_TTS_ENDPOINT> -p 8080:8080 -p 4000:4000 connecting_the_dots
```

#### Run (with env & credentials)

If your backend needs cloud creds (e.g., Google service account) or API keys, create a host folder and mount it read-only:

```bash
# make a host folder for creds
mkdir -p "$HOME/credentials"

# copy your JSON key into it (adjust the source path)
cp ~/Downloads/adbe-gcp.json "$HOME/credentials/"

docker run --rm --platform linux/amd64 \
  -v "$HOME/credentials:/credentials:ro" \
  -e GOOGLE_APPLICATION_CREDENTIALS=/credentials/adbe-gcp.json \
  -e ADOBE_EMBED_API_KEY=your_adobe_key \
  -e LLM_PROVIDER=gemini \
  -e GEMINI_MODEL=gemini-2.5-flash \
  -e TTS_PROVIDER=azure \
  -e AZURE_TTS_KEY=your_azure_key \
  -e AZURE_TTS_ENDPOINT=https://example.azure.com/tts \
  -p 8080:8080 connecting-the-dots:prod

#docker compose(optional)
docker-compose up -d
docker-compose logs -f
docker-compose down
```
🧑‍💻 Option 2 — Local Development

Backend
```bash
cd backend

# create & activate venv
python -m venv myvenv
source myvenv/bin/activate        # Windows: myvenv\Scripts\activate

# install dependencies
pip install -r requirements.txt

# create .env
cat > .env <<'EOF'
FLASK_ENV=development
PORT=4000

LLM_PROVIDER=gemini
GEMINI_MODEL=gemini-2.5-flash
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/adbe-gcp.json

ADOBE_EMBED_API_KEY=replace_me(Optional)

TTS_PROVIDER=azure
AZURE_TTS_KEY=replace_me
AZURE_TTS_ENDPOINT=https://example.azure.com/tts
EOF

# run the API
python run.py
```
Health check:
```bash
curl http://localhost:4000/api/health
```
Frontend
```bash
# from repo root
npm install
npm start
```
Environemnt variables
```bash
ADOBE_EMBED_API_KEY=...
LLM_PROVIDER=gemini
GEMINI_MODEL=gemini-2.5-flash
TTS_PROVIDER=azure
AZURE_TTS_KEY=...
AZURE_TTS_ENDPOINT=...
GOOGLE_APPLICATION_CREDENTIALS=/credentials/...
```
🛟 Troubleshooting
	•	Port already in use
```bash
Bind for 0.0.0.0:3000 failed
```
Stop anything on that port or change your mapping:
```bash
-p 8080:8080
```
•	“Heading detection failed (check backend)” in the viewer
Make sure the backend endpoints are reachable and healthy:
```bash
curl http://localhost:8080/api/health
```
•	**PDFs not opening or displaying blank pages**

Clear your browser's local storage:
1. Open Chrome Developer Tools (F12)
2. Go to the **Application** tab
3. In the left sidebar, expand **Local Storage**
4. Select your domain and clear all entries
5. Refresh the page and try uploading the PDF again