package server

import (
	"context"
	"fmt"
	"log"
	"strings"
)

// OpAMPLogger wraps a standard logger to implement the OpAMP Logger interface.
type OpAMPLogger struct {
	logger *log.Logger
}

func NewOpAMPLogger(logger *log.Logger) *OpAMPLogger {
	return &OpAMPLogger{logger: logger}
}

// sanitizeLog strips CR/LF so user-controlled values cannot forge log lines.
func sanitizeLog(s string) string {
	s = strings.ReplaceAll(s, "\n", "")
	s = strings.ReplaceAll(s, "\r", "")
	return s
}

func (l *OpAMPLogger) logf(format string, v ...interface{}) {
	l.logger.Print(sanitizeLog(fmt.Sprintf(format, v...)))
}

func (l *OpAMPLogger) Debugf(_ context.Context, format string, v ...interface{}) {
	l.logf("[DEBUG] "+format, v...)
}

func (l *OpAMPLogger) Errorf(_ context.Context, format string, v ...interface{}) {
	l.logf("[ERROR] "+format, v...)
}

func (l *OpAMPLogger) Warnf(_ context.Context, format string, v ...interface{}) {
	l.logf("[WARN] "+format, v...)
}

func (l *OpAMPLogger) Infof(_ context.Context, format string, v ...interface{}) {
	l.logf("[INFO] "+format, v...)
}

func (l *OpAMPLogger) Debug(_ context.Context, msg string) {
	l.logf("[DEBUG] %s", msg)
}

func (l *OpAMPLogger) Error(_ context.Context, msg string) {
	l.logf("[ERROR] %s", msg)
}

func (l *OpAMPLogger) Warn(_ context.Context, msg string) {
	l.logf("[WARN] %s", msg)
}

func (l *OpAMPLogger) Info(_ context.Context, msg string) {
	l.logf("[INFO] %s", msg)
}

func (l *OpAMPLogger) Printf(format string, v ...interface{}) {
	l.logf(format, v...)
}

func (l *OpAMPLogger) Print(v ...interface{}) {
	l.logger.Print(sanitizeLog(fmt.Sprint(v...)))
}

func (l *OpAMPLogger) Println(v ...interface{}) {
	l.logger.Print(sanitizeLog(fmt.Sprint(v...)))
}

func (l *OpAMPLogger) Fatal(v ...interface{}) {
	l.logger.Fatal(sanitizeLog(fmt.Sprint(v...)))
}

func (l *OpAMPLogger) Fatalf(format string, v ...interface{}) {
	l.logger.Fatal(sanitizeLog(fmt.Sprintf(format, v...)))
}

func (l *OpAMPLogger) Fatalln(v ...interface{}) {
	l.logger.Fatal(sanitizeLog(fmt.Sprint(v...)))
}

func (l *OpAMPLogger) Panic(v ...interface{}) {
	l.logger.Panic(sanitizeLog(fmt.Sprint(v...)))
}

func (l *OpAMPLogger) Panicf(format string, v ...interface{}) {
	l.logger.Panic(sanitizeLog(fmt.Sprintf(format, v...)))
}

func (l *OpAMPLogger) Panicln(v ...interface{}) {
	l.logger.Panic(sanitizeLog(fmt.Sprint(v...)))
}
