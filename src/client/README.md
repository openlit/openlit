# OpenLIT Client

[![OpenLIT](https://img.shields.io/badge/OpenLIT-orange)](https://github.com/openlit/openlit)
[![License](https://img.shields.io/github/license/openlit/openlit?label=license&logo=github&color=f80&logoColor=fff%22%20alt=%22License)](https://github.com/openlit/openlit/blob/main/LICENSE)
[![Client Version](https://img.shields.io/github/tag/openlit/openlit.svg?&label=Version)](https://github.com/openlit/openlit/tags)

![Next JS](https://img.shields.io/badge/Next-black?style=for-the-badge&logo=next.js&logoColor=white) 
![TailwindCSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white) 
![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white) 
![Clickhouse](https://img.shields.io/badge/clickhouse-faff69?style=for-the-badge&logo=clickhouse)
![Shadcn/ui](https://img.shields.io/badge/shadcn/ui-000000.svg?style=for-the-badge&logo=shadcn/ui&logoColor=white)
![Next-Auth](https://img.shields.io/badge/next-auth-2cfefe?style=for-the-badge&logo=next-auth)

OpenLIT Client serves as the frontend UI for displaying visualizations and observability data for Large Language Models (LLM), drawing data from ClickHouse. The platform leverages the power of modern web technologies like Next.js and TailwindCSS to offer an intuitive and responsive user experience.

## Features

- **Comprehensive Analytics Dashboard**: Easily monitor Large Language Model performance, user activity, and critical metrics related to costs and tokens in real-time.
- **User Management System**: Offers built-in user management to ensure secure access control and smooth authentication processes.
- **Versatile Data Source Connectivity**: Seamlessly adjust and integrate your ClickHouse database details directly within the UI. This flexibility enables quick switches between databases to keep your OpenLIT Client running efficiently.

## 🚀 Quick Start

Follow the steps below to get OpenLIT Client running in your environment. Both Docker and manual installation options are provided.


### Docker

1. **Pull the Docker image**
    ```bash
    docker pull ghcr.io/openlit/openlit-client:latest
    ```

2. **Run the container with Environment Variables**
    Here, replace `<YourValues>` with actual values for the environment variables.
    ```bash
    docker run -d -p 3000:3000 \
    -e INIT_DB_HOST="<ClickHouse-URL>" \
    -e INIT_DB_PORT="<ClickHouse-Port>" \
    -e INIT_DB_DATABASE="<ClickHouse-Database-name>" \
    -e INIT_DB_USERNAME="<ClickHouse-username>" \
    -e INIT_DB_PASSWORD="<ClickHouse-password>" \
    -e SQLITE_DATABASE_URL=file:/app/client/data/data.db \
    --name openlit-client ghcr.io/openlit/openlit-client:latest
    ```

3. Login to OpenLIT at `127.0.0.1:3000` using the default credentials and start monitoring and evaluating your LLM Applications
    - Email as `user@openlit.io`
    - Password as `openlituser`

You can also use the [OpenLIT Helm Chart](https://github.com/openlit/helm/tree/main/charts/openlit) to deploy OpenLIT Client in Kubernetes

### Manual Setup (Development)

1. **Clone the openlit repository**
    ```sh
    git clone https://github.com/openlit/openlit.git
    ```
2. **Navigate to the client folder**
    ```sh
    cd openlit/src/client
    ```
3. **Install the dependencies**
    ```sh
    npm install
    ```
4. **Configure Environemnt Variables**

    Below are the commands to set environment variables if needed during manual setup. Replace `<value>` with your actual configuration:
    ```sh
    export INIT_DB_HOST=<value>
    export INIT_DB_PORT=<value>
    export INIT_DB_DATABASE=<value>
    export INIT_DB_USERNAME=<value>
    export INIT_DB_PASSWORD=<value>
    export SQLITE_DATABASE_URL=<value>
    ```
    
5. **Apply the migrations**
    
    This creates your SQLite database schema.
    ```sh
    npx prisma migrate deploy
    npx prisma generate
    ```
6. **(Optional) Seed the database**
    
    If desired, seed the database to create a default user (`user@openlit.io` with the password `openlituser`) and database configuration.
    ```sh
    npx prisma db seed
    ```
    Ensure the database is empty before running this command.

7. **Start the development server**
    ```sh
    npm run dev
    ```
8. Login to OpenLIT at `127.0.0.1:3000` using the default credentials and start monitoring and evaluating your LLM Applications
    - Email as `user@openlit.io`
    - Password as `openlituser`

## Configuration

To configure OpenLIT Client, you can pass the following environment values, each tailored to suit your infrastructure and operational preferences. This customization allows OpenLIT Client to seamlessly integrate with your existing setup and respond to its demands effectively.


| Variable             | Description                                                                 | Required | Example                               |
|----------------------|-----------------------------------------------------------------------------|:--------:|---------------------------------------|
| `INIT_DB_HOST`       | Host address of the ClickHouse server to connect to.                        |    ✓     | `127.0.0.1`                           |
| `INIT_DB_PORT`       | Port on which ClickHouse listens.                                           |    ✓     | `8123`                                |
| `INIT_DB_DATABASE`   | Database name in ClickHouse for OpenLIT Client.                                |          | `default`                             |
| `INIT_DB_USERNAME`   | Username for authenticating with ClickHouse.                                |          | `default`                             |
| `INIT_DB_PASSWORD`   | Password for authenticating with ClickHouse.                                |          | `default`                             |
| `SQLITE_DATABASE_URL`| Location of the SQLITE database for OpenLIT Client data storage.               |    ✓     | `file:/app/client/data/data.db`       |

For more detailed information on configuration options and additional settings, please visit the OpenLIT documentation page: [OpenLIT Configuration Details](https://docs.openlit.io/latest/configuration).

## Security

We take security seriously. OpenLIT Client incorporates best practices for authentication, authorization, and secure communication to ensure data privacy and protection.

## Contributing

Contributions to OpenLIT Client are greatly appreciated. Whether you have suggestions for bug fixes, improvements, or new features, please see [CONTRIBUTING](../../CONTRIBUTING.md) for more details on submitting pull requests or opening issues.

## License

OpenLIT Client is available under the [Apache-2.0 license](../../LICENSE).

## Support

For support, issues, or feature requests, please submit an issue through the [GitHub issues](https://github.com/openlit/openlit/issues) page for this repository.
