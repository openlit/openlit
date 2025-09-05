package server

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/oklog/ulid/v2"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"opamp-server/certman"
	"opamp-server/constants"
	"opamp-server/data"

	"github.com/open-telemetry/opamp-go/protobufs"
	"github.com/open-telemetry/opamp-go/server"
	"github.com/open-telemetry/opamp-go/server/types"
)

type Server struct {
	opampSrv server.OpAMPServer
	httpSrv  *http.Server
	agents   *data.Agents
	logger   *OpAMPLogger
}

func NewServer(agents *data.Agents) *Server {
	logger := &OpAMPLogger{
		log.New(
			log.Default().Writer(),
			"[OPAMP] ",
			log.Default().Flags()|log.Lmsgprefix|log.Lmicroseconds,
		),
	}

	srv := &Server{
		agents: agents,
		logger: logger,
	}

	srv.opampSrv = server.New(logger)

	mux := http.NewServeMux()
	srv.setupRoutes(mux)
	srv.httpSrv = &http.Server{
		Addr:    "0.0.0.0:8080", // API server port
		Handler: mux,
	}

	go srv.httpSrv.ListenAndServe()

	return srv
}

func (srv *Server) Start() {
	settings := server.StartSettings{
		Settings: server.Settings{
			Callbacks: types.Callbacks{
				OnConnecting: func(request *http.Request) types.ConnectionResponse {
					return types.ConnectionResponse{
						Accept: true,
						ConnectionCallbacks: types.ConnectionCallbacks{
							OnMessage:         srv.onMessage,
							OnConnectionClose: srv.onDisconnect,
						},
					}
				},
			},
		},
		ListenEndpoint: "0.0.0.0:4320",
		HTTPMiddleware: otelhttp.NewMiddleware("/v1/opamp"),
	}
	tlsConfig, err := certman.CreateServerTLSConfig(
		constants.CaCertPath,
		constants.ServerCertPath,
		constants.ServerCertKeyPath,
	)
	if err != nil {
		srv.logger.Debugf(context.Background(), "Could not load TLS config, working without TLS: %v", err.Error())
	}
	settings.TLSConfig = tlsConfig

	if err := srv.opampSrv.Start(settings); err != nil {
		srv.logger.Errorf(context.Background(), "OpAMP server start fail: %v", err.Error())
		os.Exit(1)
	}
}

func (srv *Server) Stop() {
	srv.opampSrv.Stop(context.Background())
}

func (srv *Server) onDisconnect(conn types.Connection) {
	srv.agents.RemoveConnection(conn)
}

func (srv *Server) onMessage(ctx context.Context, conn types.Connection, msg *protobufs.AgentToServer) *protobufs.ServerToAgent {
	// Start building the response.
	response := &protobufs.ServerToAgent{}

	var instanceId data.InstanceId
	if len(msg.InstanceUid) == 26 {
		// This is an old-style ULID.
		u, err := ulid.Parse(string(msg.InstanceUid))
		if err != nil {
			srv.logger.Errorf(ctx, "Cannot parse ULID %s: %v", string(msg.InstanceUid), err)
			return response
		}
		instanceId = data.InstanceId(u.Bytes())
	} else if len(msg.InstanceUid) == 16 {
		// This is a 16 byte, new style UID.
		instanceId = data.InstanceId(msg.InstanceUid)
	} else {
		srv.logger.Errorf(ctx, "Invalid length of msg.InstanceUid")
		return response
	}

	agent := srv.agents.FindOrCreateAgent(instanceId, conn)

	// Process the status report and continue building the response.
	agent.UpdateStatus(msg, response)

	if msg.ConnectionSettingsStatus != nil {
		srv.logger.Debugf(ctx, "Connection settings for instance %x %s (err=%s) hash=%x", instanceId, msg.ConnectionSettingsStatus.Status.String(), msg.ConnectionSettingsStatus.ErrorMessage, msg.ConnectionSettingsStatus.LastConnectionSettingsHash)
	}

	// Send the response back to the Agent.
	return response
}
