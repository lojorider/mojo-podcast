APP_NAME := text2img-server
PID_FILE := .pid

.DEFAULT_GOAL := help

.PHONY: help install serv down status

help:
	@echo "text2img - AI Image Generation API"
	@echo ""
	@echo "Usage: make <command>"
	@echo ""
	@echo "Commands:"
	@echo "  install  Install dependencies"
	@echo "  serv     Start server (background)"
	@echo "  down     Stop server"
	@echo "  status   Check server status"

install:
	npm install

serv:
	@if [ -f $(PID_FILE) ] && kill -0 `cat $(PID_FILE)` 2>/dev/null; then \
		echo "$(APP_NAME) already running (PID `cat $(PID_FILE)`)"; \
	else \
		nohup node src/server.js > /dev/null 2>&1 & echo "$$!" > $(PID_FILE); \
		sleep 1; \
		echo "$(APP_NAME) started (PID `cat $(PID_FILE)`)"; \
	fi

down:
	@if [ -f $(PID_FILE) ] && kill -0 `cat $(PID_FILE)` 2>/dev/null; then \
		kill `cat $(PID_FILE)` && rm -f $(PID_FILE); \
		echo "$(APP_NAME) stopped"; \
	else \
		rm -f $(PID_FILE); \
		echo "no $(APP_NAME) running"; \
	fi

status:
	@if [ -f $(PID_FILE) ] && kill -0 `cat $(PID_FILE)` 2>/dev/null; then \
		echo "$(APP_NAME) running (PID `cat $(PID_FILE)`)"; \
	else \
		rm -f $(PID_FILE); \
		echo "no $(APP_NAME) running"; \
	fi
