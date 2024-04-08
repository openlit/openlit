# pylint: disable=duplicate-code
"""
Cohere Test Suite

This module contains a suite of tests for Cohere functionality 
using the Cohere Python library. It includes tests for various 
Cohere API endpoints such as text summarization, text generation 
with a prompt,text embeddings creation, and chat-based 
language understanding.

The tests are designed to cover different aspects of Cohere's 
capabilities and serve as a validation mechanism for the integration 
with the Doku monitoring system.

Global Cohere client and initialization are set up for the 
Cohere client and Doku monitoring.

Environment Variables:
    - COHERE_API_TOKEN: Cohere API api_key for authentication.
    - DOKU_URL: Doku URL for monitoring data submission.
    - DOKU_TOKEN: Doku authentication api_key.

Note: Ensure the environment variables are properly set before running the tests.
"""

import os
import cohere
import openlmt

# Global cohere client
co = cohere.Client(os.getenv("COHERE_API_TOKEN"))

# Global cohere initialization
# pylint: disable=line-too-long
openlmt.init(environment="dokumetry-testing", application_name="dokumetry-python-test")

# pylint disable=line-too-long
def test_summarize():
    """
    Test the 'summarize' function using the cohere client.
    """

    text = 'Ice cream is a sweetened frozen food typically eaten as a snack or dessert. ' \
           'It may be made from milk or cream and is flavored with a sweetener, ' \
           'either sugar or an alternative, and a spice, such as cocoa or vanilla, ' \
           'or with fruit such as strawberries or peaches. ' \
           'It can also be made by whisking a flavored cream base and liquid nitrogen together. ' \
           'Food coloring is sometimes added, in addition to stabilizers. ' \
           'The mixture is cooled below the freezing point of water and  ' \
           'stirred to incorporate air spaces ' \
           'and to prevent detectable ice crystals from forming. The result is a smooth, ' \
           'semi-solid foam that is solid at very low temperatures (below 2 °C or 35 °F). ' \
           'It becomes more malleable as its temperature increases.\n\n' \
           'The meaning of the name "ice cream" varies from one country to another. ' \
           'In some countries, such as the United States, "ice cream" applies ' \
           'only to a specific variety, ' \
           'and most governments regulate the commercial use of ' \
           'the various terms according to the ' \
           'relative quantities of the main ingredients, notably the amount of cream. ' \
           'Products that do not meet the criteria to be called ice cream are sometimes labeled ' \
           '"frozen dairy dessert" instead. In other countries, such as Italy and Argentina, ' \
           'one word is used for all variants. Analogues made from dairy alternatives, ' \
           "such as goat's or sheep's milk, or milk substitutes " \
           '(e.g., soy, cashew, coconut, almond milk or tofu), are available for those who are ' \
           'lactose intolerant, allergic to dairy protein or vegan.'
    try:
        summarize_resp = co.summarize(
            text=text
        )
        assert summarize_resp.id is not None

    except cohere.core.api_error.ApiError as e:
        print("Rate Limited:", e)

def test_generate_with_prompt():
    """
    Test the 'generate' function with a prompt using the cohere client.
    """
    try:
        generate_resp = co.generate(
            prompt='Doku',
            max_tokens=10
        )
        assert generate_resp.prompt == 'Doku'

    except cohere.core.api_error.ApiError as e:
        print("Rate Limited:", e)

def test_embed():
    """
    Test the 'embed' function using the cohere client.
    """
    try:
        embeddings_resp = co.embed(
            texts=['This is a test']
        )
        assert embeddings_resp.meta is not None

    except cohere.core.api_error.ApiError as e:
        print("Rate Limited:", e)

def test_chat():
    """
    Test the 'chat' function using the cohere client.
    """
    try:
        chat_resp = co.chat(
            message='Say this is a test',
            model='command'
        )
        assert chat_resp.response_id is not None

    except cohere.core.api_error.ApiError as e:
        print("Rate Limited:", e)
