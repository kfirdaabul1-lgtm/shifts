"""Publish firestore.rules to Firebase. Run by .github/workflows/deploy-rules.yml on every push that changes the rules.
Needs the repository secret FIREBASE_RULES_KEY: a service-account JSON key with the "Firebase Rules Admin" role."""
import json, os, re, sys
import requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

raw = os.environ.get("KEY", "").strip()
if not raw:
    sys.exit("Missing secret FIREBASE_RULES_KEY. See README: automatic security rules.")
creds = service_account.Credentials.from_service_account_info(
    json.loads(raw), scopes=["https://www.googleapis.com/auth/cloud-platform"])
creds.refresh(Request())
project = re.search(r'projectId:\s*"([^"]+)"', open("config.js", encoding="utf-8").read()).group(1)
headers = {"Authorization": "Bearer " + creds.token}
api = "https://firebaserules.googleapis.com/v1"

# 1. upload the rules (Firebase checks them; a mistake stops here and the old rules stay live)
r = requests.post(f"{api}/projects/{project}/rulesets", headers=headers, json={
    "source": {"files": [{"name": "firestore.rules", "content": open("firestore.rules", encoding="utf-8").read()}]}})
if not r.ok:
    sys.exit(f"Rules rejected:\n{r.text}")
ruleset = r.json()["name"]

# 2. make them the live Firestore rules
release = f"projects/{project}/releases/cloud.firestore"
r = requests.patch(f"{api}/{release}", headers=headers, json={"release": {"name": release, "rulesetName": ruleset}})
if not r.ok:
    sys.exit(f"Could not publish:\n{r.text}")
print("Published", ruleset)
