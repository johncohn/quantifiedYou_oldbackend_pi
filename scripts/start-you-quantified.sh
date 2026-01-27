#!/bin/bash

# Start frontend in a new terminal
lxterminal --title="You Quantified - Frontend" -e bash -c "cd /home/xenbox/You-Quantified-old-backend/frontend && serve -s build -p 3000; exec bash" &

# Wait a bit before starting next service
sleep 2

# Start backend in a new terminal
lxterminal --title="You Quantified - Backend" -e bash -c "cd /home/xenbox/You-Quantified-old-backend/keystone && npm run dev; exec bash" &

# Wait a bit before starting next service
sleep 2

# Start genAI in a new terminal
lxterminal --title="You Quantified - GenAI" -e bash -c "cd /home/xenbox/You-Quantified-old-backend/genAI && npm run dev; exec bash" &
