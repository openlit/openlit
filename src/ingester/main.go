package main

import (
	"context"
	"flag"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/common-nighthawk/go-figure"
	"github.com/gorilla/mux"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"ingester/api"
	"ingester/auth"
	"ingester/config"
	"ingester/connections"
	"ingester/cost"
	"ingester/db"
)

func waitForShutdown(server *http.Server) {
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)

	// Wait for an interrupt
	sig := <-quit
	log.Info().Msgf("Caught sig: %+v", sig)
	log.Info().Msg("Starting to shutdown server")

	// Initialize the context with a timeout to ensure the app can make a graceful exit
	// or abort if it takes too long
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Error().Err(err).Msg("Server shutdown failed")
	} else {
		log.Info().Msg("Server gracefully shutdown")
	}
}

// main is the entrypoint for the Doku Ingester service. It sets up logging,
// initializes the database and observability platforms, starts the HTTP server,
// and handles graceful shutdown.
func main() {
	figure.NewColorFigure("DOKU Ingester", "", "yellow", true).Print()
	// Configure global settings for the zerolog logger
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Info().Msg("Starting Doku Ingester")

	// Use flag package to parse the configuration file
	configFilePath := flag.String("config", "./config.yml", "Path to the Doku Ingester config file")
	flag.Parse()

	// Load the configuration
	cfg, err := config.LoadConfiguration(*configFilePath)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to load configuration file")
	}

	// Load pricing information, either from a local file or from a URL
	if cfg.PricingInfo.URL != "" {
		log.Info().Msgf("Initializing LLM Pricing Information from URL '%s'", cfg.PricingInfo.URL)
		err = cost.LoadPricing("", cfg.PricingInfo.URL)
	} else if cfg.PricingInfo.LocalFile.Path != "" {
		log.Info().Msgf("Initializing LLM Pricing Information from local file '%s", cfg.PricingInfo.LocalFile.Path)
		err = cost.LoadPricing(cfg.PricingInfo.LocalFile.Path, "")
	}
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to load LLM pricing information")
	}
	log.Info().Msg("Successfully initialized LLM pricing information")

	// Initialize the backend database connection with loaded configuration
	log.Info().Msg("Initializing connection to the backend database")
	err = db.Init(*cfg)
	if err != nil {
		log.Fatal().Msg("Unable to initialize connection to the backend database")
	}
	log.Info().Msg("Successfully initialized connection to the backend database")

	// Initialize observability platform if configured
	if cfg.Connections.Enabled == true {
		log.Info().Msg("Initializing for your Observability Platform")
		err := connections.Init(*cfg)
		if err != nil {
			log.Fatal().Msg("Exiting due to error in initializing for your Observability Platform")
		}
		log.Info().Msg("Setup complete for sending data to your Observability Platform")
	}

	// Cache eviction setup for the authentication process
	auth.InitializeCacheEviction()

	// Initialize the HTTP server routing
	r := mux.NewRouter()
	r.HandleFunc("/api/push", api.DataHandler).Methods("POST")
	r.HandleFunc("/api/keys", api.APIKeyHandler).Methods("GET", "POST", "DELETE")
	r.HandleFunc("/", api.BaseEndpoint).Methods("GET")

	// Define and start the HTTP server
	server := &http.Server{
		Addr:         ":" + cfg.IngesterPort,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	// Starts the HTTP server in a goroutine and logs any error upon starting.
	go func() {
		log.Info().Msg("Server listening on port " + cfg.IngesterPort)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("Could not listen on port " + cfg.IngesterPort)
		}
	}()

	waitForShutdown(server)
}
