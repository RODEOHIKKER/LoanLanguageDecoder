from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
import os
import io
from dotenv import load_dotenv
import pypdf

load_dotenv()

app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"


def build_system_prompt(language: str) -> str:
    return f"""You are a legal plain-language assistant for low-income Indian borrowers who have no financial or legal background.

Analyze the loan document provided. Identify every significant clause.

For each clause return a JSON array where each item has exactly these fields:
- clause: the original clause text copied verbatim
- explanation: plain language explanation a Class 8 student can understand
- risk: exactly one of these values: "red", "yellow", or "green"
- reason: one sentence explaining why you assigned that risk level

Risk classification guide:
- red: potentially predatory or harmful — high penalty rates, lender discretion clauses, waiver of borrower rights, hidden fees
- yellow: important to understand but not necessarily harmful — prepayment terms, interest calculation method, modification rights
- green: completely standard boilerplate found in every loan agreement

Return ALL explanations in {language}.
Return ONLY a valid JSON array.
Do NOT use markdown.
Do NOT wrap in code fences.
Do NOT add any text before or after the JSON array.
Start your response with [ and end with ]."""


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract text from PDF bytes using pypdf."""
    reader = pypdf.PdfReader(io.BytesIO(file_bytes))
    full_text = ""
    for page in reader.pages:
        text = page.extract_text()
        if text:
            full_text += text + "\n"
    return full_text.strip()


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/analyze", methods=["POST"])
def analyze():
    if not GEMINI_API_KEY:
        return jsonify({"error": "Server misconfiguration: API key not set."}), 500

    language = "English"
    loan_text = ""

    # ── Handle PDF upload (multipart/form-data) ──
    if request.content_type and "multipart/form-data" in request.content_type:
        language = request.form.get("language", "English").strip()
        pdf_file = request.files.get("pdf")

        if not pdf_file:
            return jsonify({"error": "No PDF file received."}), 400

        try:
            pdf_bytes = pdf_file.read()
            loan_text = extract_text_from_pdf(pdf_bytes)
        except Exception as e:
            return jsonify({"error": f"Failed to read PDF: {str(e)}"}), 400

        if not loan_text or len(loan_text) < 50:
            return jsonify({"error": "Could not extract text from this PDF. Make sure it is a digital PDF, not a scanned image."}), 400

    # ── Handle plain text (application/json) ──
    else:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid request body."}), 400
        loan_text = data.get("text", "").strip()
        language = data.get("language", "English").strip()

        if not loan_text:
            return jsonify({"error": "No loan text provided."}), 400

    if len(loan_text) > 80000:
        loan_text = loan_text[:80000]

    system_prompt = build_system_prompt(language)

    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"parts": [{"text": loan_text}]}]
    }

    try:
        response = requests.post(
            f"{GEMINI_URL}?key={GEMINI_API_KEY}",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=90
        )
        response.raise_for_status()
        gemini_data = response.json()
        raw_text = gemini_data["candidates"][0]["content"]["parts"][0]["text"]
        return jsonify({"result": raw_text})

    except requests.exceptions.Timeout:
        return jsonify({"error": "Gemini API timed out. Please try again."}), 504

    except requests.exceptions.HTTPError as e:
        try:
            err_msg = response.json().get("error", {}).get("message", str(e))
        except Exception:
            err_msg = str(e)
        return jsonify({"error": f"Gemini API error: {err_msg}"}), 502

    except Exception as e:
        return jsonify({"error": f"Unexpected server error: {str(e)}"}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
