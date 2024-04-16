# pylint: disable=duplicate-code, no-name-in-module
"""
This module contains tests for ChromaDB functionality using the ChromaDB Python library.

Tests cover various API endpoints, including create_collection, add, query,
upsert, update, get, peek and delete. 
These tests validate integration with OpenLIT.
"""

import chromadb
import openlit

# Initialize the Chroma client
chroma_client = chromadb.Client()

# Initialize environment and application name for OpenLIT monitoring
openlit.init(environment="openlit-testing", application_name="openlit-python-test")

def test_db_chroma():
    """
    Tests synchronous messages with the 'claude-3-haiku-20240307' model.

    Raises:
        AssertionError: If the messages response object is not as expected.
    """

    collection = chroma_client.create_collection(name="openlit")
    assert collection.name == 'openlit'

    db_add = collection.add(
        documents=["This is a document", "This is another document"],
        metadatas=[{"source": "my_source"}, {"source": "my_source"}],
        ids=["id1", "id2"]
    )
    assert db_add is None

    query = collection.query(
        query_texts=["This is a query document"],
        n_results=2
    )
    assert query["ids"] == [['id1', 'id2']]

    db_delete = collection.delete(
        ids=["id2"],
        where={"source": "my_source"}
    )
    assert db_delete is None
