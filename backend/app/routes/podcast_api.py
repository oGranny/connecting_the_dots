from flask import Blueprint, request, jsonify

bp = Blueprint("podcast_api", __name__)

@bp.post("/api/podcast")
def podcast():
    data = request.get_json(force=True, silent=True) or {}
    topic = data.get("topic", "Reaction Kinetics")
    length = data.get("length", "3 min")
    script = (
        f"Welcome to a quick micro-podcast on {topic}. "
        "We’ll start with why kinetics matters: it tells you how fast reactions proceed… "
        "Next, rate laws: identify orders experimentally using method of initial rates… "
        "Then the Arrhenius equation: temperature changes can dramatically affect rate constants… "
        "Finally, mechanisms: the slow step governs the observed rate law. "
        "That’s your crash course! Good luck with your prep."
    )
    return jsonify({"topic": topic, "length": length, "script": script, "audio_url": None})
