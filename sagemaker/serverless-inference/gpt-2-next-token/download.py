import os
from transformers import GPT2Tokenizer, GPT2LMHeadModel

cwd = os.environ.get("INIT_CWD", os.getcwd())

tokenizer = GPT2Tokenizer.from_pretrained("gpt2")
model = GPT2LMHeadModel.from_pretrained("gpt2")

model_path = os.path.join(cwd, "model")
print(f"Saving model and tokenizer to {model_path}")

model.save_pretrained(save_directory=model_path)
tokenizer.save_pretrained(save_directory=model_path)
