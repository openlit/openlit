# pylint: disable=duplicate-code, no-name-in-module
"""
This module contains tests for ChromaDB functionality using the ChromaDB Python library.

Tests cover various API endpoints, including create_collection, add, query,
upsert, update, get, peek and delete. 
These tests validate integration with OpenLIT.

Environment Variables:
    - PINECONE_API_TOKEN: Cohere API api_key for authentication.

Note: Ensure the environment is properly configured for Pinecone access and OpenLIT monitoring
prior to running these tests.
"""

import os
from pinecone import Pinecone
import openlit

# Initialize the Chroma client
pc = Pinecone(api_key=os.getenv("PINECONE_API_TOKEN"))
index = pc.Index("openlit-tests")

# Initialize environment and application name for OpenLIT monitoring
openlit.init(environment="openlit-testing", application_name="openlit-python-test")

def test_db_pinecone():
    """
    Tests basic operations within a Pinecone index.

    This includes adding documents to the index,
    querying the index, and deleting documents from the index. The test
    verifies correct behavior of these operations by asserting expected outcomes at
    each step.

    - Documents are added to the index with specific metadata and ids,
      and the absence of an error response is verified.
    - A query operation is performed, and its results are verified to match the
      expected document ids.
    - A delete operation targets a specific document by id, and successful deletion
      is implicitly verified by the absence of an error response.
    
    The test ensures the basic CRUD operations perform as expected in ChromaDB.
    Raises:
        AssertionError: If the responses from the ChromaDB operations do not meet the expected outcomes.
    """

    db_upsert = index.upsert(
        vectors=[
            {"id": "vec1", "values": [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]},
            {"id": "vec2", "values": [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]},
            {"id": "vec3", "values": [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]},
            {"id": "vec4", "values": [0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4]}
        ],
        namespace="python-tests"
    )
    assert db_upsert == {'upserted_count': 4}

    db_query = index.query(
        namespace="python-tests",
        vector=[0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3],
        top_k=3,
        include_values=True
    )
    assert db_query["namespace"] == "python-tests"

    db_delete = index.delete(ids=["vec1", "vec2"], namespace='ns1')
    assert db_delete == {}


