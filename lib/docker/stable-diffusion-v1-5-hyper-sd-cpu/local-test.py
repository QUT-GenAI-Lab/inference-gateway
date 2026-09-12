from datetime import datetime
from pathlib import Path
from time import monotonic, sleep

import httpx

BASE_URL = "http://localhost:8000"
OUTPUT_DIR = Path("output")


def main():
    OUTPUT_DIR.mkdir(exist_ok=True)

    while True:
        try:
            response = httpx.get(f"{BASE_URL}/health", timeout=5)
            if response.status_code != 200:
                print(f"Server health check failed with status code {response.status_code}. Retrying...")
                sleep(5)
                continue
        except httpx.RequestError as e:
            print(f"Server health check failed: {e}. Retrying...")
            sleep(5)
            continue
        
        prompt = input(">>> Prompt ('q' to quit): ").strip()

        if prompt.lower() in {"q", "quit", "exit"}:
            break

        print("Generating...")

        start_time = monotonic()
        try:
            response = httpx.post(
                f"{BASE_URL}/generate",
                json={"prompt": prompt},
                headers={"Accept": "image/jpeg"},
                timeout=300,
            )
            if response.status_code != 200:
                print(f"Error {response.status_code}: {response.text}")
                continue
        except httpx.RequestError as e:
            print(f"Request failed: {e}")
            continue
        end_time = monotonic()


        timestamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")
        path = OUTPUT_DIR / f"{timestamp}.png"
        path.write_bytes(response.content)
        print(f"Saved image to {path} (took {end_time - start_time:.2f} seconds)")


if __name__ == "__main__":
    main()
