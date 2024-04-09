from langchain_core.tools import tool
import getpass
import os
from langchain_openai.chat_models import ChatOpenAI
import inspect
import importlib.metadata
import openlmt
from langchain import hub
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

# module = importlib.import_module("langchain.chains.combine_documents.base")
#         # loop through all public classes in the module
# for name, obj in inspect.getmembers(module, lambda member: inspect.isclass(member) and member.__module__ == module.__name__,):
#     # loop through all public methods of the class
#         for method_name, _ in inspect.getmembers(obj, predicate=inspect.isfunction):
#             # Skip private methods
#             if method_name.startswith("_"):
#                 continue

#             method_path = f"{name}.{method_name}"
#             print(method_name)
                
openlmt.init()

os.environ["OPENAI_API_KEY"] = "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"

chat = ChatOpenAI(model="gpt-3.5-turbo-1106", temperature=0.2)

from langchain_community.document_loaders import WebBaseLoader

loader = WebBaseLoader("https://docs.smith.langchain.com/overview")
data = loader.load()

from langchain_text_splitters import RecursiveCharacterTextSplitter

text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=0)
all_splits = text_splitter.split_documents(data)

from langchain_community.vectorstores import Chroma
from langchain_openai import OpenAIEmbeddings

vectorstore = Chroma.from_documents(documents=all_splits, embedding=OpenAIEmbeddings())

# k is the number of chunks to retrieve
docs = vectorstore.as_retriever(k=4).invoke("how can langsmith help with testing?")

from langchain.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

chat = ChatOpenAI(model="gpt-3.5-turbo-1106")

question_answering_prompt = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Answer the user's questions based on the below context:\n\n{context}",
        ),
        MessagesPlaceholder(variable_name="messages"),
    ]
)

document_chain = create_stuff_documents_chain(chat, question_answering_prompt)