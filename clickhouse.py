# # Display Tables in Clickhouse
# from clickhouse_driver import Client

# # Connect to Clickhouse
# client = Client(host='127.0.0.1', user='default', password='DOKU', database='openlmt')

# # Getting the list of existing tables
# tables = client.execute('SHOW TABLES')

# # Print the existing tables in the database
# print("Existing tables in the database:")
# for table in tables:
#     print(table)

# Display data from table in Clickhouse
from clickhouse_driver import Client

client = Client(host='146.190.11.107', user='default', password='DOKU', database='openlmt')

# Replace your_table_name with the name of your table
query = "SELECT * FROM otel_traces"

result = client.execute(query)

# Print each row
for row in result:
    print(row)

{ "llm.application.name": "default", "llm.cost": "0.04", "llm.endpoint": "openai.images.generate", "llm.environment": "default", "llm.generation": "Image", "llm.image.0": "https://oaidalleapiprodscus.blob.core.windows.net/private/org-RXrPv8fY9rahdyxaw5fhwxub/user-n6FKIY0GXgswDw8hYylgRcWZ/img-oaSyOlThitNke4FVyIrTDEAQ.png?st=2024-04-04T13%3A38%3A42Z&se=2024-04-04T15%3A38%3A42Z&sp=r&sv=2021-08-06&sr=b&rscd=inline&rsct=image/png&skoid=6aaadede-4fb3-4698-a8f6-684d7786b067&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2024-04-03T20%3A31%3A27Z&ske=2024-04-04T20%3A31%3A27Z&sks=b&skv=2021-08-06&sig=Rgay49pBCzVhpCJbjFulBMJ5jxcdMl%2BnBDgmAh0PrXY%3D", "llm.image.quality": "standard", "llm.image.size": "1024x1024", "llm.image.style": "vivid", "llm.model": "dall-e-3", "llm.prompt": "Create a dashboard for LLM Observability data", "llm.provider": "OpenAI", "llm.req.id": "1712241522", "llm.request.duration": "16.889642000198364", "llm.revised.prompt": "An intricate dashboard displaying various elements related to LLM Observability data. This includes various panels showing key metrics such as response times, system up-time, CPU usage, memory allocation, network traffic and volume spikes. The dashboard should be organized logically with clear headings and labels. It should also be interactive, allowing data to be further broken down when clicked on for more detailed analysis. Elements like bar graphs, pie charts, line graphs, and heat maps should be incorporated to illustrate the data more effectively. The whole setup should have a sleek, modern design contrasted against a subdued dark background.", "llm.user": "" }
