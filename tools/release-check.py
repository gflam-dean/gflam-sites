import os, sys
print("fake gate", "RED" if os.path.exists(os.path.join(os.path.dirname(__file__), "RED")) else "green")
sys.exit(1 if os.path.exists(os.path.join(os.path.dirname(__file__), "RED")) else 0)
