import time
import urllib.request

print("Non-LLM HTTP app starting -- making regular HTTP calls every 30s")
i = 0
while True:
    try:
        req = urllib.request.Request(
            "https://httpbin.org/get",
            headers={"User-Agent": "openlit-test/1.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"[{i}] httpbin status={resp.status}")
    except Exception as e:
        print(f"[{i}] Error: {e}")

    try:
        req2 = urllib.request.Request("https://api.github.com/zen")
        with urllib.request.urlopen(req2, timeout=10) as resp2:
            print(f"[{i}] github zen: {resp2.read().decode().strip()}")
    except Exception as e:
        print(f"[{i}] GitHub error: {e}")

    i += 1
    time.sleep(30)
