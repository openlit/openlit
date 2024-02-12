from openai import OpenAI
import dokumetry

client = OpenAI(
    api_key="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",
)

# Pass the above `client` object along with your DOKU URL and API key and this will make sure that all OpenAI calls are automatically tracked.
dokumetry.init(llm=client, doku_url="http://127.0.0.1:9044", api_key="dkc0af105388fd03f3b7349fb64102c73a568a1e18")

completion = client.chat.completions.create(
  model="gpt-3.5-turbo",
  messages=[
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ]
)

print(completion.choices[0].message)