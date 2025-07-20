#!/usr/bin/env python3
"""
Simple test to check if initialization context is working
"""

import sys
import os
sys.path.insert(0, 'sdk/python/src')
os.environ['OPENAI_API_KEY'] = 'sk-test'

import openlit
openlit.init()

from mem0 import Memory

print("Creating Memory instance...")
memory = Memory()
print("Done!")