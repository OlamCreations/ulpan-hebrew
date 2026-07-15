#!/usr/bin/env python3
"""Ulpan Hebrew — usage analytics summary (Cloudflare Analytics Engine).

Reads events written by the Worker /track route. Anonymous by design: counts,
countries, devices, top lessons — no PII. Real counts use sum(_sample_interval)
(Analytics Engine samples at high volume; at low volume the interval is 1).

Usage:  python3 stats.py [days]        # window in days, default 7
Creds:  C:/dev/_secrets/cloudflare-ulpan.env  (CF_API_TOKEN, CF_ACCOUNT_ID)
"""
import json, os, sys, urllib.request, re

DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 7
ENV = r"C:/dev/_secrets/cloudflare-ulpan.env"

def load_env(path):
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = re.match(r'\s*(?:export\s+)?(\w+)\s*=\s*"?([^"\n]+)"?', line)
            if m:
                out[m.group(1)] = m.group(2)
    return out

env = load_env(ENV)
TOKEN, ACCOUNT = env["CF_API_TOKEN"], env["CF_ACCOUNT_ID"]
URL = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/analytics_engine/sql"
WINDOW = f"timestamp > NOW() - INTERVAL '{DAYS}' DAY"

def q(sql):
    req = urllib.request.Request(URL, data=sql.encode("utf-8"),
                                 headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read()).get("data", [])

def table(title, rows, cols):
    print(f"\n\033[1m{title}\033[0m")
    if not rows:
        print("  (no data yet)")
        return
    widths = [max(len(str(c)), max(len(str(r[k])) for r in rows)) for c, k in cols]
    for r in rows:
        print("  " + "  ".join(str(r[k]).ljust(w) for (c, k), w in zip(cols, widths)))

print(f"\n=== Ulpan usage — last {DAYS} day(s) ===")

head = q(f"SELECT sum(_sample_interval) AS events, count(DISTINCT index1) AS users FROM ulpan_events WHERE {WINDOW}")
today = q("SELECT sum(_sample_interval) AS events, count(DISTINCT index1) AS users FROM ulpan_events WHERE timestamp > NOW() - INTERVAL '1' DAY")
if head:
    ev = int(head[0]["events"] or 0); us = int(head[0]["users"] or 0)
    per = round(ev / us, 1) if us else 0
    print(f"\n\033[1mTotal\033[0m  events: {ev}   unique visitors: {us}   engagement: {per} events/visitor")
    if today:
        print(f"\033[1mToday\033[0m  events: {today[0]['events'] or 0}   visitors: {today[0]['users'] or 0}")

table("By event", q(f"SELECT blob1 AS event, sum(_sample_interval) AS n FROM ulpan_events WHERE {WINDOW} GROUP BY event ORDER BY n DESC"),
      [("event", "event"), ("count", "n")])
table("Errors (Sentry-lite)", q(f"SELECT blob3 AS message, blob5 AS device, sum(_sample_interval) AS n FROM ulpan_events WHERE blob1='error' AND {WINDOW} GROUP BY message, device ORDER BY n DESC LIMIT 20"),
      [("message", "message"), ("device", "device"), ("count", "n")])
table("Top lessons (page views)", q(f"SELECT blob2 AS page, sum(_sample_interval) AS n FROM ulpan_events WHERE blob1='page_view' AND {WINDOW} GROUP BY page ORDER BY n DESC LIMIT 20"),
      [("page", "page"), ("views", "n")])
table("By country", q(f"SELECT blob4 AS country, sum(_sample_interval) AS n FROM ulpan_events WHERE {WINDOW} GROUP BY country ORDER BY n DESC"),
      [("country", "country"), ("count", "n")])
table("By device", q(f"SELECT blob5 AS device, sum(_sample_interval) AS n FROM ulpan_events WHERE {WINDOW} GROUP BY device ORDER BY n DESC"),
      [("device", "device"), ("count", "n")])
table("Daily activity", q(f"SELECT toDate(timestamp) AS day, sum(_sample_interval) AS events, count(DISTINCT index1) AS users FROM ulpan_events WHERE {WINDOW} GROUP BY day ORDER BY day"),
      [("day", "day"), ("events", "events"), ("users", "users")])
print()
