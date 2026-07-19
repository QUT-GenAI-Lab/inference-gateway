import json
from model.code.inference import model_fn, input_fn, predict_fn, output_fn
import subprocess
import os

COMMANDS = {
    "/help": "Show this help message.",
    "/exit": "Exit the program.",
    "/clear": "Clear the screen.",
    "/system": "Set the system message.",
}

context = model_fn("./model")
system_message = "You are a helpful assistant."


def print_help():
    print("Available commands:")
    for command, description in COMMANDS.items():
        print(f"\t{command}: {description}")


def execute_command(command):
    if command == "/help":
        print_help()
    elif command == "/exit":
        print("Exiting the program.")
        exit(0)
    elif command == "/clear":
        subprocess.call("cls" if os.name == "nt" else "clear", shell=True)
    elif command.startswith("/system"):
        global context, system_message
        new_system_message = command[len("/system ") :].strip()
        system_message = new_system_message
        print(f"System message updated to: {system_message}")
    else:
        print(f"Unknown command: {command}. Type /help for a list of commands.")


def main():
    while True:
        print("\nEnter your message (or type /help for commands):")
        user_input = input("> ").strip()

        if user_input.startswith("/"):
            execute_command(user_input)
        else:
            request = json.dumps(
                {
                    "messages": [{"role": "user", "content": user_input}],
                    "system": system_message,
                }
            )
            data = input_fn(request, "application/json")
            prediction = predict_fn(data, context)
            body, content_type = output_fn(prediction, "application/json")
            print(f"Content-Type: {content_type}")
            print(f"Response: {body}")


if __name__ == "__main__":
    main()
