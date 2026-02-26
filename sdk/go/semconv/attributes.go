package semconv

import (
	"encoding/json"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// SetStringAttribute sets a string attribute on a span if value is not empty
func SetStringAttribute(span trace.Span, key, value string) {
	if value != "" {
		span.SetAttributes(attribute.String(key, value))
	}
}

// SetIntAttribute sets an int attribute on a span
func SetIntAttribute(span trace.Span, key string, value int) {
	span.SetAttributes(attribute.Int(key, value))
}

// SetInt64Attribute sets an int64 attribute on a span
func SetInt64Attribute(span trace.Span, key string, value int64) {
	span.SetAttributes(attribute.Int64(key, value))
}

// SetFloat64Attribute sets a float64 attribute on a span
func SetFloat64Attribute(span trace.Span, key string, value float64) {
	span.SetAttributes(attribute.Float64(key, value))
}

// SetBoolAttribute sets a bool attribute on a span
func SetBoolAttribute(span trace.Span, key string, value bool) {
	span.SetAttributes(attribute.Bool(key, value))
}

// SetStringSliceAttribute sets a string slice attribute on a span if not empty
func SetStringSliceAttribute(span trace.Span, key string, values []string) {
	if len(values) > 0 {
		span.SetAttributes(attribute.StringSlice(key, values))
	}
}

// SetJSONAttribute sets a JSON-encoded attribute on a span
func SetJSONAttribute(span trace.Span, key string, value interface{}) error {
	if value == nil {
		return nil
	}

	jsonBytes, err := json.Marshal(value)
	if err != nil {
		return err
	}

	span.SetAttributes(attribute.String(key, string(jsonBytes)))
	return nil
}

// Message represents a chat message structure
type Message struct {
	Role    string        `json:"role"`
	Content string        `json:"content,omitempty"`
	Parts   []MessagePart `json:"parts,omitempty"`
}

// MessagePart represents a part of a message (text, image, etc.)
type MessagePart struct {
	Type    string `json:"type"`
	Content string `json:"content,omitempty"`
	Text    string `json:"text,omitempty"`
}

// ToolCall represents a tool/function call
type ToolCall struct {
	ID       string `json:"id,omitempty"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function,omitempty"`
}

// ToolDefinition represents a tool/function definition
type ToolDefinition struct {
	Type     string `json:"type"`
	Function struct {
		Name        string                 `json:"name"`
		Description string                 `json:"description,omitempty"`
		Parameters  map[string]interface{} `json:"parameters,omitempty"`
	} `json:"function,omitempty"`
}

// SetMessagesAttribute sets structured messages as JSON attribute
func SetMessagesAttribute(span trace.Span, key string, messages []Message) error {
	if len(messages) == 0 {
		return nil
	}
	return SetJSONAttribute(span, key, messages)
}

// SetToolCallsAttribute sets tool calls as JSON attribute
func SetToolCallsAttribute(span trace.Span, key string, toolCalls []ToolCall) error {
	if len(toolCalls) == 0 {
		return nil
	}
	return SetJSONAttribute(span, key, toolCalls)
}

// SetToolDefinitionsAttribute sets tool definitions as JSON attribute
func SetToolDefinitionsAttribute(span trace.Span, key string, tools []ToolDefinition) error {
	if len(tools) == 0 {
		return nil
	}
	return SetJSONAttribute(span, key, tools)
}

// AttributeBuilder provides a fluent interface for building attributes
type AttributeBuilder struct {
	attributes []attribute.KeyValue
}

// NewAttributeBuilder creates a new attribute builder
func NewAttributeBuilder() *AttributeBuilder {
	return &AttributeBuilder{
		attributes: make([]attribute.KeyValue, 0),
	}
}

// String adds a string attribute
func (ab *AttributeBuilder) String(key, value string) *AttributeBuilder {
	if value != "" {
		ab.attributes = append(ab.attributes, attribute.String(key, value))
	}
	return ab
}

// Int adds an int attribute
func (ab *AttributeBuilder) Int(key string, value int) *AttributeBuilder {
	ab.attributes = append(ab.attributes, attribute.Int(key, value))
	return ab
}

// Int64 adds an int64 attribute
func (ab *AttributeBuilder) Int64(key string, value int64) *AttributeBuilder {
	ab.attributes = append(ab.attributes, attribute.Int64(key, value))
	return ab
}

// Float64 adds a float64 attribute
func (ab *AttributeBuilder) Float64(key string, value float64) *AttributeBuilder {
	ab.attributes = append(ab.attributes, attribute.Float64(key, value))
	return ab
}

// Bool adds a bool attribute
func (ab *AttributeBuilder) Bool(key string, value bool) *AttributeBuilder {
	ab.attributes = append(ab.attributes, attribute.Bool(key, value))
	return ab
}

// StringSlice adds a string slice attribute
func (ab *AttributeBuilder) StringSlice(key string, values []string) *AttributeBuilder {
	if len(values) > 0 {
		ab.attributes = append(ab.attributes, attribute.StringSlice(key, values))
	}
	return ab
}

// Build returns the built attributes
func (ab *AttributeBuilder) Build() []attribute.KeyValue {
	return ab.attributes
}

// SetAttributes sets all attributes on a span
func (ab *AttributeBuilder) SetAttributes(span trace.Span) {
	span.SetAttributes(ab.attributes...)
}
