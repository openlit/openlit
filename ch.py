# Display Tables in Clickhouse
from clickhouse_driver import Client

# Connect to Clickhouse
client = Client(host='146.190.11.107', user='default', password='DOKU', database='openlmt')

# Getting the list of existing tables
tables = client.execute('SHOW TABLES')

# Print the existing tables in the database
print("Existing tables in the database:")
for table in tables:
    print(table[0])


# # Display data from table in Clickhouse
# from clickhouse_driver import Client

# client = Client(host='146.190.11.107, user='default', password='DOKU', database='openlmt')

# # Replace your_table_name with the name of your table
# query = "SELECT * FROM DOKU_APIKEYS"

# result = client.execute(query)

# # Print each row
# for row in result:
#     print(row)