from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
import os
import json
import re
from dotenv import load_dotenv
import time

load_dotenv(override=True)

app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent"
)

# ─────────────────────────────────────────────
# LOAD FAIRNESS DATASET
# ─────────────────────────────────────────────

with open("benchmarks.json", "r", encoding="utf-8") as f:
    BENCHMARKS = json.load(f)

PERSONAL_LOAN = BENCHMARKS["personal_loan"]


# ─────────────────────────────────────────────
# PROMPTS
# ─────────────────────────────────────────────

def build_clause_prompt(language: str) -> str:
    return f"""
You are a legal plain-language assistant for low-income Indian borrowers.

Analyze ONLY the 8 MOST IMPORTANT borrower-related clauses.

Prioritize:
- interest rates
- penalties
- lender powers
- borrower rights
- foreclosure
- repayment obligations
- recovery actions
- hidden charges

Return a JSON array.

Each item must contain:
- clause
- explanation
- risk
- reason

Rules:
- explanation must be SHORT
- explanation must be easy to understand
- risk must be exactly:
  "red", "yellow", or "green"

Return explanations in {language}.

Return ONLY valid JSON.
No markdown.
"""



def build_extraction_prompt() -> str:
    return """
You are a loan risk extraction engine.

Extract the following fields from the loan document.

Return ONLY valid JSON.

{
  "loan_type": "personal_loan",

  "interest_rate": number_or_null,
  "processing_fee_percent": number_or_null,
  "additional_interest_percent": number_or_null,
  "prepayment_lockin_months": number_or_null,

  "risk_patterns": {
    "variable_interest_without_cap": true_or_false,
    "daily_compounding": true_or_false,
    "aggressive_recovery": true_or_false,
    "unilateral_lender_power": true_or_false,
    "data_sharing_without_limit": true_or_false,
    "no_grace_period": true_or_false,
    "no_notice_on_default": true_or_false,
    "broad_indemnity": true_or_false,
    "statement_conclusive": true_or_false,
    "loan_transfer_without_consent": true_or_false,
    "security_demand_on_unsecured_loan": true_or_false,
    "increased_cost_transfer": true_or_false
  }
}
"""


# ─────────────────────────────────────────────
# GEMINI CALL
# ─────────────────────────────────────────────

def call_gemini(system_prompt: str, user_text: str):
    payload = {
        "system_instruction": {
            "parts": [{"text": system_prompt}]
        },
        "contents": [
            {
                "parts": [{"text": user_text}]
            }
        ],
        "generationConfig": {
            "thinkingConfig": {
                "thinkingBudget": 0
            },
            "responseMimeType": "application/json"
        }
    }

    

    for attempt in range(3):

        try:

            response = requests.post(
                f"{GEMINI_URL}?key={GEMINI_API_KEY}",
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=120
            )

            response.raise_for_status()

            data = response.json()

            return data["candidates"][0]["content"]["parts"][0]["text"]

        except requests.exceptions.HTTPError as e:

            if response.status_code == 503 and attempt < 2:

                print("Gemini overloaded. Retrying...")
                time.sleep(2)

                continue

            raise e


# ─────────────────────────────────────────────
# JSON PARSER
# ─────────────────────────────────────────────

def parse_json(raw):
    cleaned = raw.replace("```json", "").replace("```", "").strip()

    try:
        return json.loads(cleaned)
    except:
        match = re.search(r'(\{.*\}|\[.*\])', cleaned, re.DOTALL)

        if match:
            return json.loads(match.group(1))

        raise Exception("Could not parse Gemini JSON response")


# ─────────────────────────────────────────────
# FAIRNESS ENGINE
# ─────────────────────────────────────────────

def calculate_fairness(extracted):

    scoring = PERSONAL_LOAN["scoring"]

    score = scoring["starting_score"]

    major_risks = []

    # ── Interest rate scoring ──
    interest = extracted.get("interest_rate")

    if interest is not None:
        for threshold in scoring["interest_rate_thresholds"]:
            if interest > threshold["above"]:
                score -= threshold["deduction"]

                if threshold["deduction"] >= 15:
                    major_risks.append(
                        f"Interest rate ({interest}%) exceeds common market ranges"
                    )

                break

    # ── Processing fee scoring ──
    processing_fee = extracted.get("processing_fee_percent")

    if processing_fee is not None:
        for threshold in scoring["processing_fee_thresholds"]:
            if processing_fee > threshold["above"]:
                score -= threshold["deduction"]

                if threshold["deduction"] >= 10:
                    major_risks.append(
                        f"Processing fee ({processing_fee}%) is unusually high"
                    )

                break

    # ── Additional interest scoring ──
    additional_interest = extracted.get("additional_interest_percent")

    if additional_interest is not None:
        for threshold in scoring["additional_interest_thresholds"]:
            if additional_interest > threshold["above"]:
                score -= threshold["deduction"]

                major_risks.append(
                    "Heavy penal interest on overdue payments"
                )

                break

    # ── Prepayment lock-in scoring ──
    lockin = extracted.get("prepayment_lockin_months")

    if lockin is not None:
        for threshold in scoring["prepayment_lock_in_thresholds"]:
            if lockin > threshold["above_months"]:
                score -= threshold["deduction"]

                major_risks.append(
                    "Long prepayment lock-in period"
                )

                break

    # ── Risk pattern scoring ──
    risk_patterns = extracted.get("risk_patterns", {})

    penalties = PERSONAL_LOAN["risk_pattern_penalties"]

    for pattern, active in risk_patterns.items():

        if active and pattern in penalties:

            deduction = penalties[pattern]["score_deduction"]

            score -= deduction

            major_risks.append(
                penalties[pattern]["description"]
            )

    # ── Clamp score ──
    score = max(0, min(100, score))

    # ── Classification ──
    classification = {}

    for cls in scoring["classifications"]:
        if cls["min"] <= score <= cls["max"]:
            classification = cls
            break

    return {
        "fairness_score": score,
        "classification": classification,
        "major_risks": major_risks[:5],

        "market_comparison": {
            "interest_rate": {
                "loan_value": interest,
                "typical_range": (
                    f"{PERSONAL_LOAN['interest_rate']['typical_low']}"
                    f"-{PERSONAL_LOAN['interest_rate']['typical_high']}%"
                )
            },

            "processing_fee": {
                "loan_value": processing_fee,
                "typical_range": (
                    f"0-{PERSONAL_LOAN['processing_fee']['typical_percent']}%"
                )
            }
        }
    }


# ─────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/analyze", methods=["POST"])
def analyze():

    if not GEMINI_API_KEY:
        return jsonify({
            "error": "Gemini API key missing."
        }), 500

    data = request.get_json()

    loan_text = data.get("text", "").strip()
    loan_text = loan_text[:25000]


    language = data.get("language", "English")

    if not loan_text:
        return jsonify({
            "error": "No loan text provided."
        }), 400

    try:

        # ─────────────────────
        # CLAUSE ANALYSIS
        # ─────────────────────

        clause_prompt = build_clause_prompt(language)

        clause_raw = call_gemini(
            clause_prompt,
            loan_text
        )

        clauses = parse_json(clause_raw)

        # ─────────────────────
        # STRUCTURED EXTRACTION
        # ─────────────────────

        extraction_prompt = build_extraction_prompt()

        extraction_raw = call_gemini(
            extraction_prompt,
            loan_text
        )

        extracted = parse_json(extraction_raw)

        # ─────────────────────
        # FAIRNESS ENGINE
        # ─────────────────────

        fairness = calculate_fairness(extracted)

        # ─────────────────────
        # FINAL RESPONSE
        # ─────────────────────

        return jsonify({
            "clauses": clauses,
            "fairness": fairness,
            "extracted": extracted
        })

    except requests.exceptions.Timeout:
        return jsonify({
            "error": "Gemini timed out."
        }), 504

    except requests.exceptions.HTTPError as e:
        return jsonify({
            "error": f"Gemini API error: {str(e)}"
        }), 502

    except Exception as e:
        return jsonify({
            "error": f"Server error: {str(e)}"
        }), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)

