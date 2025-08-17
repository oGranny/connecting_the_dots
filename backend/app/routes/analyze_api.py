import uuid
from flask import Blueprint, request, jsonify
from ..services.pdf_service import open_doc

bp = Blueprint("analyze_api", __name__)

@bp.post("/api/analyze")
def analyze():
    data = request.get_json(force=True, silent=True) or {}
    persona = data.get("persona", "Student")
    jtbd = data.get("jtbd", "Study key concepts")
    ids = data.get("ids", [])
    insights = [
        {"id": uuid.uuid4().hex, "title": "Separate kinetics from thermodynamics",
         "body": "Focus on rate laws and mechanisms; thermodynamics explains feasibility, not speed."},
        {"id": uuid.uuid4().hex, "title": "Temperature sensitivity",
         "body": "Arrhenius shows exponential dependence of rate on temperature; log form linearizes for plotting."}
    ]
    facts = [
        {"id": uuid.uuid4().hex, "text": "Catalysts change pathway, not ΔG; equilibrium position remains unchanged."},
        {"id": uuid.uuid4().hex, "text": "Pseudo-first-order: treat one reactant concentration as constant when in excess."},
    ]
    connections = [
        {"id": uuid.uuid4().hex, "text": "Observed rate law aligns with slow (rate-determining) elementary step.",
         "jump": {"page": 6}}
    ]
    related = []
    for fid in ids[:1]:
        try:
            doc, _ = open_doc(fid)
            name = fid.split("_", 1)[-1]
            related.extend([
                {"id": uuid.uuid4().hex, "docName": name, "page": 2, "title": "Rate Laws",
                 "snippet": "The rate of a reaction depends on concentrations raised to reaction orders…"},
                {"id": uuid.uuid4().hex, "docName": name, "page": 4, "title": "Arrhenius Equation",
                 "snippet": "k = A·e^(−Ea/RT). Linear form: ln k = ln A − Ea/RT…"},
            ])
        except Exception:
            pass
    return jsonify({
        "persona": persona, "jtbd": jtbd,
        "insights": insights, "facts": facts, "connections": connections, "related": related
    })
