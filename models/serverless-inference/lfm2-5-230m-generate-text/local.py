import json
import os
import sys

code_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model", "code")
sys.path.insert(0, code_dir)

from inference import input_fn, model_fn, output_fn, predict_fn  # noqa: E402

context = model_fn("./model")

while True:
    try:
        user_input = input("> ").strip()
    except EOFError:
        break
    if user_input in {"/exit", "/quit"}:
        break
    if not user_input:
        continue

    request = json.dumps({"messages": [{"role": "user", "content": user_input}]})
    data = input_fn(request, "application/json")
    body, _ = output_fn(predict_fn(data, context), "application/json")
    print(body)
