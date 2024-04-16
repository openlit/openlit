# pylint: disable=duplicate-code
"""
This module contains tests for ChromaDB functionality using the ChromaDB Python library.

Tests cover various API endpoints, including create_collection, add, query,
upsert, update, get, peek and delete. 
These tests validate integration with OpenLIT.

Note: Ensure the environment is properly configured for ChromaDB access and OpenLIT monitoring
prior to running these tests.
"""

import bs4
from langchain import hub
from langchain_community.document_loaders import WebBaseLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
import openlit

# Initialize environment and application name for OpenLIT monitoring
openlit.init(environment="openlit-testing", application_name="openlit-python-test")

def test_langchain():
  docs = WebBaseLoader(
    web_paths=("https://lilianweng.github.io/posts/2023-06-23-agent/",),
    bs_kwargs=dict(
        parse_only=bs4.SoupStrainer(
            class_=("post-content", "post-title", "post-header")
        )
    ),
  ).load()
  assert docs[0].metadata["source"] == "https://lilianweng.github.io/posts/2023-06-23-agent/"

  splits = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200).split_documents(docs)
  assert splits[0].metadata["source"] == "https://lilianweng.github.io/posts/2023-06-23-agent/"

  prompt = hub.pull("rlm/rag-prompt")
  assert prompt.metadata["lc_hub_repo"] == "rag-prompt"
