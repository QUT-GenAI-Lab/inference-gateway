import argparse
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

MODEL_ID = "stable-diffusion-v1-5/stable-diffusion-v1-5"
MODEL_DIRECTORY = Path(__file__).resolve().parent / "model"
CODE_DIRECTORY = MODEL_DIRECTORY / "code"
if str(CODE_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(CODE_DIRECTORY))

from model.code.inference import input_fn, model_fn, output_fn, predict_fn

DEFAULTS = {
    "width": 512,
    "height": 512,
    "steps": 25,
    "guidance_scale": 7.25,
    "seed": None,
    "image_format": "jpeg",
    "output_path": None,
}

COMMANDS = {
    "/help": "Show this help message.",
    "/exit": "Exit the program.",
    "/clear": "Clear the terminal.",
    "/settings": "Show the current generation settings.",
    "/dimensions <width> <height>": "Set output dimensions. Default 512x512. Must be divisible by 8.",
    "/steps <1-50>": f"Set the number of inference steps. Default {DEFAULTS['steps']}.",
    "/guidance <0-20>": f"Set the guidance scale. Default {DEFAULTS['guidance_scale']}.",
    "/seed <0-4294967295|random>": "Set a fixed or random seed.",
    "/format <jpeg|png>": "Set the output image format. Default jpeg.",
    "/output <path|default>": "Set the output path. Default is output.<format> in the current directory.",
}


@dataclass
class SessionSettings:
    width: int = DEFAULTS["width"]
    height: int = DEFAULTS["height"]
    steps: int = DEFAULTS["steps"]
    guidance_scale: float = DEFAULTS["guidance_scale"]
    seed: int | None = DEFAULTS["seed"]
    image_format: str = DEFAULTS["image_format"]
    output_path: Path | None = None

    def resolved_output_path(self) -> Path:
        return self.output_path or Path(f"output.{self.image_format}")


def print_help() -> None:
    print("Enter an image prompt to generate, or use one of these commands:")
    for command, description in COMMANDS.items():
        print(f"  {command:<38} {description}")


def print_settings(settings: SessionSettings) -> None:
    seed = str(settings.seed) if settings.seed is not None else "random"
    print("Current settings:")
    print(f"  Dimensions:     {settings.width}x{settings.height}")
    print(f"  Steps:          {settings.steps}")
    print(f"  Guidance scale: {settings.guidance_scale:g}")
    print(f"  Seed:           {seed}")
    print(f"  Format:         {settings.image_format}")
    print(f"  Output:         {settings.resolved_output_path()}")


def _parse_integer(
    value: str,
    field_name: str,
    minimum: int,
    maximum: int,
) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise ValueError(f"{field_name} must be an integer") from error
    if not minimum <= parsed <= maximum:
        raise ValueError(f"{field_name} must be between {minimum} and {maximum}")
    return parsed


def execute_command(command_line: str, settings: SessionSettings) -> bool:
    command, _, argument = command_line.partition(" ")
    argument = argument.strip()

    try:
        if command == "/help":
            print_help()
        elif command == "/exit":
            print("Exiting the program.")
            return False
        elif command == "/clear":
            subprocess.call("cls" if os.name == "nt" else "clear", shell=True)
        elif command == "/settings":
            print_settings(settings)
        elif command == "/dimensions":
            parts = argument.split()
            if len(parts) != 2:
                raise ValueError("usage: /dimensions <width> <height>")
            width = _parse_integer(parts[0], "width", 64, 1024)
            height = _parse_integer(parts[1], "height", 64, 1024)
            if width % 8 != 0 or height % 8 != 0:
                raise ValueError("width and height must be divisible by 8")
            settings.width = width
            settings.height = height
            print(f"Dimensions set to {width}x{height}.")
        elif command == "/steps":
            settings.steps = _parse_integer(argument, "steps", minimum=1, maximum=50)
            print(f"Inference steps set to {settings.steps}.")
        elif command == "/guidance":
            try:
                guidance_scale = float(argument)
            except ValueError as error:
                raise ValueError("guidance scale must be a number") from error
            if not 0 <= guidance_scale <= 20:
                raise ValueError("guidance scale must be between 0 and 20")
            settings.guidance_scale = guidance_scale
            print(f"Guidance scale set to {guidance_scale:g}.")
        elif command == "/seed":
            if argument.lower() == "random":
                settings.seed = None
                print("A random seed will be generated for each image.")
            else:
                settings.seed = _parse_integer(
                    argument, "seed", minimum=0, maximum=4_294_967_295
                )
                print(f"Seed set to {settings.seed}.")
        elif command == "/format":
            image_format = argument.lower()
            if image_format not in {"jpeg", "png"}:
                raise ValueError("format must be jpeg or png")
            settings.image_format = image_format
            print(f"Output format set to {image_format}.")
        elif command == "/output":
            if not argument:
                raise ValueError("usage: /output <path|default>")
            settings.output_path = (
                None if argument.lower() == "default" else Path(argument)
            )
            print(f"Output path set to {settings.resolved_output_path()}.")
        else:
            print(f"Unknown command: {command}. Type /help for available commands.")
    except ValueError as error:
        print(f"Error: {error}")

    return True


def generate_image(
    prompt: str,
    settings: SessionSettings,
    context: dict[str, Any],
) -> None:
    request: dict[str, Any] = {
        "prompt": prompt,
        "dimensions": {
            "width": settings.width,
            "height": settings.height,
        },
        "model": MODEL_ID,
        "config": {
            "num_inference_steps": settings.steps,
            "guidance_scale": settings.guidance_scale,
        },
    }
    if settings.seed is not None:
        request["seed"] = settings.seed

    data = input_fn(json.dumps(request), "application/json")
    prediction = predict_fn(data, context)
    content_type = f"image/{settings.image_format}"
    body = output_fn(prediction, content_type)
    if not isinstance(body, bytes):
        raise TypeError("image generation returned a non-binary response")

    output_path = settings.resolved_output_path()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(body)
    print(
        f"Generated {len(body)} bytes ({content_type}), "
        f"seed={data['seed']} -> {output_path}"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run an interactive Stable Diffusion image generator."
    )
    parser.add_argument(
        "prompt",
        nargs="?",
        help="Optional prompt to generate before entering interactive mode.",
    )
    parser.add_argument("--width", type=int, default=DEFAULTS["width"])
    parser.add_argument("--height", type=int, default=DEFAULTS["height"])
    parser.add_argument("--seed", type=int)
    parser.add_argument("--steps", type=int, default=DEFAULTS["steps"])
    parser.add_argument(
        "--guidance-scale", type=float, default=DEFAULTS["guidance_scale"]
    )
    parser.add_argument(
        "--format", choices=("jpeg", "png"), default=DEFAULTS["image_format"]
    )
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = SessionSettings(
        width=args.width,
        height=args.height,
        steps=args.steps,
        guidance_scale=args.guidance_scale,
        seed=args.seed,
        image_format=args.format,
        output_path=args.output,
    )

    validation_request: dict[str, Any] = {
        "prompt": args.prompt if args.prompt is not None else "",
        "dimensions": {
            "width": settings.width,
            "height": settings.height,
        },
        "model": MODEL_ID,
        "config": {
            "num_inference_steps": settings.steps,
            "guidance_scale": settings.guidance_scale,
        },
    }
    if settings.seed is not None:
        validation_request["seed"] = settings.seed
    input_fn(json.dumps(validation_request), "application/json")

    print("Loading Stable Diffusion. This may take a moment...")
    context = model_fn(str(MODEL_DIRECTORY))
    print("Stable Diffusion is ready.")
    print_help()
    print_settings(settings)

    if args.prompt is not None:
        generate_image(args.prompt, settings, context)

    while True:
        try:
            prompt = input("\nimage> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting the program.")
            break

        if prompt.startswith("/"):
            if not execute_command(prompt, settings):
                break
            continue

        try:
            generate_image(prompt, settings, context)
        except (OSError, RuntimeError, ValueError) as error:
            print(f"Generation failed: {error}")


if __name__ == "__main__":
    main()
