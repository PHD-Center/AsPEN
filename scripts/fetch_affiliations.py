"""Fetch author affiliations from PubMed efetch for all PMIDs in publications.json.

For each paper, derive a list of unique ISO 3166-1 alpha-2 country codes
based on the affiliation strings of all authors. Writes the result to
src/data/affiliations.json keyed by PMID:

    {
      "23653370": { "countries": ["DK", "SE", "JP", "KR", "TW"] },
      ...
    }

Run from project root:  python scripts/fetch_affiliations.py
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBS = ROOT / "src" / "data" / "publications.json"
OUT  = ROOT / "src" / "data" / "affiliations.json"

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
BATCH = 50  # max ids per efetch request

# Heuristic: substring (case-insensitive) -> ISO alpha-2
# Order matters; first match wins per affiliation string
COUNTRY_RULES: list[tuple[str, str]] = [
    # Most-specific city/region hints first
    ("hong kong", "HK"),
    ("taiwan", "TW"),
    ("taipei", "TW"),
    ("kaohsiung", "TW"),
    ("tainan", "TW"),
    ("hsinchu", "TW"),
    ("south korea", "KR"),
    ("republic of korea", "KR"),
    ("seoul", "KR"),
    ("suwon", "KR"),
    (", korea", "KR"),
    ("japan", "JP"),
    ("tokyo", "JP"),
    ("osaka", "JP"),
    ("kyoto", "JP"),
    ("china", "CN"),
    ("singapore", "SG"),
    ("thailand", "TH"),
    ("bangkok", "TH"),
    ("malaysia", "MY"),
    ("vietnam", "VN"),
    ("indonesia", "ID"),
    ("philippines", "PH"),
    ("india", "IN"),
    ("australia", "AU"),
    ("sydney", "AU"),
    ("melbourne", "AU"),
    ("new zealand", "NZ"),
    ("united kingdom", "GB"),
    ("england", "GB"),
    ("scotland", "GB"),
    ("wales", "GB"),
    ("london", "GB"),
    ("oxford", "GB"),
    ("cambridge", "GB"),  # ambiguous w/ MA; left to UK first since most AsPEN UK
    (" uk.", "GB"),
    (" u.k.", "GB"),
    (", uk", "GB"),
    ("ireland", "IE"),
    ("united states", "US"),
    (" usa", "US"),
    (" u.s.a", "US"),
    (", us.", "US"),
    ("california", "US"),
    ("boston", "US"),
    ("new york", "US"),
    ("massachusetts", "US"),
    ("maryland", "US"),
    ("pennsylvania", "US"),
    ("canada", "CA"),
    ("netherlands", "NL"),
    ("utrecht", "NL"),
    ("amsterdam", "NL"),
    ("germany", "DE"),
    ("france", "FR"),
    ("italy", "IT"),
    ("spain", "ES"),
    ("sweden", "SE"),
    ("stockholm", "SE"),
    ("denmark", "DK"),
    ("copenhagen", "DK"),
    ("norway", "NO"),
    ("finland", "FI"),
    ("helsinki", "FI"),
    ("switzerland", "CH"),
    ("belgium", "BE"),
    ("austria", "AT"),
    ("portugal", "PT"),
    ("brazil", "BR"),
    ("argentina", "AR"),
    ("mexico", "MX"),
    ("south africa", "ZA"),
    ("israel", "IL"),
]


def fetch_xml(pmids: list[str], attempt: int = 1) -> bytes:
    url = f"{EUTILS}?db=pubmed&retmode=xml&id={','.join(pmids)}"
    req = urllib.request.Request(url, headers={"User-Agent": "AsPEN-site/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read()
    except (urllib.error.URLError, TimeoutError) as e:
        if attempt >= 4:
            raise
        wait = 2 ** attempt
        print(f"  fetch error ({e}), retrying in {wait}s…", file=sys.stderr)
        time.sleep(wait)
        return fetch_xml(pmids, attempt + 1)


def affiliation_to_country(aff: str) -> str | None:
    s = aff.lower()
    for needle, code in COUNTRY_RULES:
        if needle in s:
            return code
    return None


def parse_article(article: ET.Element) -> tuple[str, list[str]]:
    pmid_el = article.find(".//PMID")
    pmid = pmid_el.text if pmid_el is not None else ""
    countries: list[str] = []
    seen: set[str] = set()
    for aff_info in article.findall(".//Author/AffiliationInfo/Affiliation"):
        if aff_info.text:
            code = affiliation_to_country(aff_info.text)
            if code and code not in seen:
                seen.add(code)
                countries.append(code)
    return pmid, countries


def main() -> None:
    pubs = json.loads(PUBS.read_text(encoding="utf-8"))
    pmids = [p["pmid"] for p in pubs if p.get("pmid")]
    print(f"Fetching affiliations for {len(pmids)} PMIDs…")

    results: dict[str, dict] = {}

    for i in range(0, len(pmids), BATCH):
        batch = pmids[i : i + BATCH]
        print(f"  batch {i // BATCH + 1}: {len(batch)} pmids")
        xml = fetch_xml(batch)
        root = ET.fromstring(xml)
        for article in root.findall(".//PubmedArticle"):
            pmid, countries = parse_article(article)
            results[pmid] = {"countries": countries}
        time.sleep(0.4)  # NCBI rate limit: 3/sec without API key

    # Fill missing PMIDs with empty list (so downstream code can assume the key exists)
    for pmid in pmids:
        results.setdefault(pmid, {"countries": []})

    OUT.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    # Brief stats
    with_aff = sum(1 for v in results.values() if v["countries"])
    countries_seen: set[str] = set()
    for v in results.values():
        countries_seen.update(v["countries"])
    print(f"\nDone. {with_aff}/{len(pmids)} papers got >=1 country.")
    print(f"Distinct countries: {sorted(countries_seen)}")
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
