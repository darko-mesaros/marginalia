# Marginalia justfile
#
# Quick start:
#   just run                                  # default model, default AWS profile
#   just run "moonshotai.kimi-k2.5"           # pick a model
#   just run "moonshotai.kimi-k2.5" personal  # pick a model + AWS profile
#
# You can also override the defaults globally, e.g.:
#   just model="amazon.nova-pro-v1:0" profile="personal" run

# Default Bedrock model (mirrors the app's built-in default)
model := "qwen.qwen3-vl-235b-a22b"

# AWS named profile used for Bedrock auth (falls back to AWS_PROFILE, then "default")
profile := env_var_or_default("AWS_PROFILE", "default")

# Server port
port := "3000"

# Show available recipes
default:
    @just --list

# Install dependencies
install:
    npm install

# Launch the server with a specific model and AWS profile.
# Positional args override the variables above: `just run <model> <profile>`
run model=model profile=profile:
    AWS_PROFILE="{{profile}}" BEDROCK_MODEL_ID="{{model}}" PORT="{{port}}" npm start

# Same as `run` but with auto-reload (tsx watch)
dev model=model profile=profile:
    AWS_PROFILE="{{profile}}" BEDROCK_MODEL_ID="{{model}}" PORT="{{port}}" npm run dev

# Compile TypeScript
build:
    npm run build

# Run the test suite
test:
    npm test
