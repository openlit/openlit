package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ingester/api"
	"ingester/auth"
	"ingester/config"
	"ingester/connections"
	"ingester/cost"
	"ingester/db"
	"ingester/nocode"

	"github.com/common-nighthawk/go-figure"
	_ "github.com/go-co-op/gocron"
	"github.com/gorilla/mux"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func waitForShutdown(server *http.Server) {
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)

	// Wait for an interrupt
	sig := <-quit
	log.Info().Msgf("caught sig: %+v", sig)
	log.Info().Msg("starting to shutdown server")

	// Initialize the context with a timeout to ensure the app can make a graceful exit
	// or abort if it takes too long
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Error().Err(err).Msg("server shutdown failed")
	} else {
		log.Info().Msg("server gracefully shutdown")
	}
}

// main is the entrypoint for the Doku Ingester service. It sets up logging,
// initializes the database and observability platforms, starts the HTTP server,
// and handles graceful shutdown.
func main() {
	figure.NewColorFigure("DOKU Ingester", "", "yellow", true).Print()
	// Configure global settings for the zerolog logger
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Info().Msg("starting Doku Ingester")

	// Load the configuration from the environment variables
	cfg, err := config.LoadConfigFromEnv()
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to load configuration from environment")
	}

	// Initialize the pricing information from the URL
	log.Info().Msgf("initializing LLM Pricing Information from URL '%s'", cfg.Pricing.URL)
	err = cost.LoadPricing("", cfg.Pricing.URL)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to load LLM pricing information")
	}

	// Initialize the http client for the observability platforms
	connections.Init()

	log.Info().Msg("successfully initialized LLM pricing information")

	// Initialize the backend database connection with loaded configuration
	log.Info().Msg("initializing connection to the backend database")
	err = db.Init(*cfg)
	if err != nil {
		log.Fatal().Msgf("%v", err)
	}
	log.Info().Msg("successfully initialized connection to the backend database")

	// Cache eviction setup for the API Keys and Connections
	auth.InitializeCacheEviction()

	// // Initialize a new scheduler
	// s := gocron.NewScheduler(time.UTC)

	// // Schedule RunOpenAITask to run at 11:50 PM UTC every day
	// _, err = s.Every(1).Day().At("08:23").Do(nocode.RunOpenAITask)
	// if err != nil {
	// 	log.Error().Err(err).Msg("Failed to schedule the OpenAI task for retrieval of usage data")
	// }

	// s.StartAsync()

	nocode.RunOpenAITask()

	// Initialize the HTTP server routing
	r := mux.NewRouter()
	r.HandleFunc("/api/push", api.DataHandler).Methods("POST")
	r.HandleFunc("/api/keys", api.APIKeyHandler).Methods("GET", "POST", "DELETE")
	r.HandleFunc("/", api.BaseEndpoint).Methods("GET")
	r.HandleFunc("/api/connections", api.ConnectionsHandler).Methods("POST", "DELETE", "GET")

	// Define and start the HTTP server
	server := &http.Server{
		Addr:         ":9044",
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	// Starts the HTTP server in a goroutine and logs any error upon starting.
	go func() {
		log.Info().Msg("server listening on port :9044")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("could not listen on port :9044")
		}
	}()

	waitForShutdown(server)
}
