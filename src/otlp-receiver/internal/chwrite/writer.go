package chwrite

import (
	"context"
	"fmt"
	"strconv"
	"sync"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"

	"github.com/openlit/openlit/otlp-receiver/internal/chschema"
	"github.com/openlit/openlit/otlp-receiver/internal/config"
	"github.com/openlit/openlit/otlp-receiver/internal/otlpconv"
)

type Writer struct {
	mu    sync.Mutex
	conns map[string]driver.Conn
}

func New() *Writer {
	return &Writer{conns: map[string]driver.Conn{}}
}

func (w *Writer) Close() {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, c := range w.conns {
		_ = c.Close()
	}
	w.conns = map[string]driver.Conn{}
}

func protocolForPort(port string) clickhouse.Protocol {
	n, _ := strconv.Atoi(port)
	if n == 9000 || n == 9440 {
		return clickhouse.Native
	}
	return clickhouse.HTTP
}

func connKey(cfg config.ClickHouseConfig) string {
	return fmt.Sprintf("%s|%s|%s|%s|%s", cfg.Host, cfg.Port, cfg.Username, cfg.Database, cfg.Password)
}

func (w *Writer) conn(ctx context.Context, cfg config.ClickHouseConfig) (driver.Conn, error) {
	key := connKey(cfg)
	w.mu.Lock()
	if c, ok := w.conns[key]; ok {
		w.mu.Unlock()
		return c, nil
	}
	w.mu.Unlock()

	port := cfg.Port
	if port == "" {
		port = "8123"
	}
	c, err := clickhouse.Open(&clickhouse.Options{
		Addr:     []string{fmt.Sprintf("%s:%s", cfg.Host, port)},
		Protocol: protocolForPort(port),
		Auth: clickhouse.Auth{
			Database: cfg.Database,
			Username: cfg.Username,
			Password: cfg.Password,
		},
		Compression: &clickhouse.Compression{Method: clickhouse.CompressionLZ4},
	})
	if err != nil {
		return nil, err
	}
	if err := c.Ping(ctx); err != nil {
		_ = c.Close()
		return nil, err
	}

	w.mu.Lock()
	if existing, ok := w.conns[key]; ok {
		w.mu.Unlock()
		_ = c.Close()
		return existing, nil
	}
	w.conns[key] = c
	w.mu.Unlock()
	return c, nil
}

func (w *Writer) withConn(ctx context.Context, cfg config.ClickHouseConfig, fn func(driver.Conn) error) error {
	c, err := w.conn(ctx, cfg)
	if err != nil {
		return err
	}
	key := connKey(cfg)
	if err := chschema.Ensure(ctx, c, key); err != nil {
		return err
	}
	err = fn(c)
	if !chschema.IsMissingTable(err) {
		return err
	}
	chschema.Forget(key)
	if err := chschema.Ensure(ctx, c, key); err != nil {
		return err
	}
	return fn(c)
}

func (w *Writer) InsertTraces(ctx context.Context, cfg config.ClickHouseConfig, rows []otlpconv.TraceRow) error {
	if len(rows) == 0 {
		return nil
	}
	return w.withConn(ctx, cfg, func(c driver.Conn) error {
		batch, err := c.PrepareBatch(ctx, `INSERT INTO otel_traces (
		Timestamp, TraceId, SpanId, ParentSpanId, TraceState, SpanName, SpanKind, ServiceName,
		ResourceAttributes, ScopeName, ScopeVersion, SpanAttributes, Duration, StatusCode, StatusMessage,
		Events.Timestamp, Events.Name, Events.Attributes, Links.TraceId, Links.SpanId, Links.TraceState, Links.Attributes
	)`)
		if err != nil {
			return err
		}
		for _, row := range rows {
			if err := batch.Append(
				row.Timestamp,
				row.TraceID,
				row.SpanID,
				row.ParentSpanID,
				row.TraceState,
				row.SpanName,
				row.SpanKind,
				row.ServiceName,
				row.ResourceAttributes,
				row.ScopeName,
				row.ScopeVersion,
				row.SpanAttributes,
				row.Duration,
				row.StatusCode,
				row.StatusMessage,
				row.EventTimestamps,
				row.EventNames,
				row.EventAttributes,
				row.LinkTraceIDs,
				row.LinkSpanIDs,
				row.LinkTraceStates,
				row.LinkAttributes,
			); err != nil {
				return err
			}
		}
		return batch.Send()
	})
}

func (w *Writer) InsertLogs(ctx context.Context, cfg config.ClickHouseConfig, rows []otlpconv.LogRow) error {
	if len(rows) == 0 {
		return nil
	}
	return w.withConn(ctx, cfg, func(c driver.Conn) error {
		batch, err := c.PrepareBatch(ctx, `INSERT INTO otel_logs (
		Timestamp, TraceId, SpanId, TraceFlags, SeverityText, SeverityNumber, ServiceName, Body,
		ResourceSchemaUrl, ResourceAttributes, ScopeSchemaUrl, ScopeName, ScopeVersion, ScopeAttributes, LogAttributes
	)`)
		if err != nil {
			return err
		}
		for _, row := range rows {
			if err := batch.Append(
				row.Timestamp,
				row.TraceID,
				row.SpanID,
				row.TraceFlags,
				row.SeverityText,
				row.SeverityNumber,
				row.ServiceName,
				row.Body,
				row.ResourceSchemaURL,
				row.ResourceAttributes,
				row.ScopeSchemaURL,
				row.ScopeName,
				row.ScopeVersion,
				row.ScopeAttributes,
				row.LogAttributes,
			); err != nil {
				return err
			}
		}
		return batch.Send()
	})
}

func (w *Writer) InsertGauges(ctx context.Context, cfg config.ClickHouseConfig, rows []otlpconv.GaugeRow) error {
	if len(rows) == 0 {
		return nil
	}
	return w.withConn(ctx, cfg, func(c driver.Conn) error {
		batch, err := c.PrepareBatch(ctx, `INSERT INTO otel_metrics_gauge (
		ResourceAttributes, ResourceSchemaUrl, ScopeName, ScopeVersion, ScopeAttributes, ScopeDroppedAttrCount,
		ScopeSchemaUrl, ServiceName, MetricName, MetricDescription, MetricUnit, Attributes, StartTimeUnix, TimeUnix, Value, Flags
	)`)
		if err != nil {
			return err
		}
		for _, row := range rows {
			if err := batch.Append(
				row.ResourceAttributes,
				row.ResourceSchemaURL,
				row.ScopeName,
				row.ScopeVersion,
				row.ScopeAttributes,
				row.ScopeDroppedCount,
				row.ScopeSchemaURL,
				row.ServiceName,
				row.MetricName,
				row.MetricDescription,
				row.MetricUnit,
				row.Attributes,
				row.StartTimeUnix,
				row.TimeUnix,
				row.Value,
				row.Flags,
			); err != nil {
				return err
			}
		}
		return batch.Send()
	})
}

func (w *Writer) InsertSums(ctx context.Context, cfg config.ClickHouseConfig, rows []otlpconv.SumRow) error {
	if len(rows) == 0 {
		return nil
	}
	return w.withConn(ctx, cfg, func(c driver.Conn) error {
		batch, err := c.PrepareBatch(ctx, `INSERT INTO otel_metrics_sum (
		ResourceAttributes, ResourceSchemaUrl, ScopeName, ScopeVersion, ScopeAttributes, ScopeDroppedAttrCount,
		ScopeSchemaUrl, ServiceName, MetricName, MetricDescription, MetricUnit, Attributes, StartTimeUnix, TimeUnix,
		Value, Flags, AggregationTemporality, IsMonotonic
	)`)
		if err != nil {
			return err
		}
		for _, row := range rows {
			if err := batch.Append(
				row.ResourceAttributes,
				row.ResourceSchemaURL,
				row.ScopeName,
				row.ScopeVersion,
				row.ScopeAttributes,
				row.ScopeDroppedCount,
				row.ScopeSchemaURL,
				row.ServiceName,
				row.MetricName,
				row.MetricDescription,
				row.MetricUnit,
				row.Attributes,
				row.StartTimeUnix,
				row.TimeUnix,
				row.Value,
				row.Flags,
				row.AggregationTemporality,
				row.IsMonotonic,
			); err != nil {
				return err
			}
		}
		return batch.Send()
	})
}

func (w *Writer) InsertHistograms(ctx context.Context, cfg config.ClickHouseConfig, rows []otlpconv.HistogramRow) error {
	if len(rows) == 0 {
		return nil
	}
	return w.withConn(ctx, cfg, func(c driver.Conn) error {
		batch, err := c.PrepareBatch(ctx, `INSERT INTO otel_metrics_histogram (
		ResourceAttributes, ResourceSchemaUrl, ScopeName, ScopeVersion, ScopeAttributes, ScopeDroppedAttrCount,
		ScopeSchemaUrl, ServiceName, MetricName, MetricDescription, MetricUnit, Attributes, StartTimeUnix, TimeUnix,
		Count, Sum, BucketCounts, ExplicitBounds, Flags, Min, Max, AggregationTemporality
	)`)
		if err != nil {
			return err
		}
		for _, row := range rows {
			if err := batch.Append(
				row.ResourceAttributes,
				row.ResourceSchemaURL,
				row.ScopeName,
				row.ScopeVersion,
				row.ScopeAttributes,
				row.ScopeDroppedCount,
				row.ScopeSchemaURL,
				row.ServiceName,
				row.MetricName,
				row.MetricDescription,
				row.MetricUnit,
				row.Attributes,
				row.StartTimeUnix,
				row.TimeUnix,
				row.Count,
				row.Sum,
				row.BucketCounts,
				row.ExplicitBounds,
				row.Flags,
				row.Min,
				row.Max,
				row.AggregationTemporality,
			); err != nil {
				return err
			}
		}
		return batch.Send()
	})
}

func (w *Writer) InsertSummaries(ctx context.Context, cfg config.ClickHouseConfig, rows []otlpconv.SummaryRow) error {
	if len(rows) == 0 {
		return nil
	}
	return w.withConn(ctx, cfg, func(c driver.Conn) error {
		batch, err := c.PrepareBatch(ctx, `INSERT INTO otel_metrics_summary (
		ResourceAttributes, ResourceSchemaUrl, ScopeName, ScopeVersion, ScopeAttributes, ScopeDroppedAttrCount,
		ScopeSchemaUrl, ServiceName, MetricName, MetricDescription, MetricUnit, Attributes, StartTimeUnix, TimeUnix,
		Count, Sum, ValueAtQuantiles.Quantile, ValueAtQuantiles.Value, Flags
	)`)
		if err != nil {
			return err
		}
		for _, row := range rows {
			if err := batch.Append(
				row.ResourceAttributes,
				row.ResourceSchemaURL,
				row.ScopeName,
				row.ScopeVersion,
				row.ScopeAttributes,
				row.ScopeDroppedCount,
				row.ScopeSchemaURL,
				row.ServiceName,
				row.MetricName,
				row.MetricDescription,
				row.MetricUnit,
				row.Attributes,
				row.StartTimeUnix,
				row.TimeUnix,
				row.Count,
				row.Sum,
				row.Quantiles,
				row.Values,
				row.Flags,
			); err != nil {
				return err
			}
		}
		return batch.Send()
	})
}

func (w *Writer) InsertExpHistograms(ctx context.Context, cfg config.ClickHouseConfig, rows []otlpconv.ExpHistogramRow) error {
	if len(rows) == 0 {
		return nil
	}
	return w.withConn(ctx, cfg, func(c driver.Conn) error {
		batch, err := c.PrepareBatch(ctx, `INSERT INTO otel_metrics_exponential_histogram (
		ResourceAttributes, ResourceSchemaUrl, ScopeName, ScopeVersion, ScopeAttributes, ScopeDroppedAttrCount,
		ScopeSchemaUrl, ServiceName, MetricName, MetricDescription, MetricUnit, Attributes, StartTimeUnix, TimeUnix,
		Count, Sum, Scale, ZeroCount, PositiveOffset, PositiveBucketCounts, NegativeOffset, NegativeBucketCounts,
		Flags, Min, Max, AggregationTemporality
	)`)
		if err != nil {
			return err
		}
		for _, row := range rows {
			if err := batch.Append(
				row.ResourceAttributes,
				row.ResourceSchemaURL,
				row.ScopeName,
				row.ScopeVersion,
				row.ScopeAttributes,
				row.ScopeDroppedCount,
				row.ScopeSchemaURL,
				row.ServiceName,
				row.MetricName,
				row.MetricDescription,
				row.MetricUnit,
				row.Attributes,
				row.StartTimeUnix,
				row.TimeUnix,
				row.Count,
				row.Sum,
				row.Scale,
				row.ZeroCount,
				row.PositiveOffset,
				row.PositiveBucketCounts,
				row.NegativeOffset,
				row.NegativeBucketCounts,
				row.Flags,
				row.Min,
				row.Max,
				row.AggregationTemporality,
			); err != nil {
				return err
			}
		}
		return batch.Send()
	})
}
