# The appliance's local-model runtime: llama.cpp `llama-server`.
#
# WHY llama-server AND NOT OLLAMA (the design's §2.2 verify-first flag,
# answered empirically — recorded in 02): the AI provider (AiApi.cs)
# speaks OpenAI-compatible POST {AI_ENDPOINT}/chat/completions with
# tools + tool_choice="required" and hard-requires a tool_calls response
# — enforcement is LOAD-BEARING (the model must never answer in prose).
# llama-server with --jinja was VERIFIED to grammar-enforce exactly that
# in the real-model eval (52/54, every must-refuse held). Ollama could
# not be verified: its embedded runner segfaulted reproducibly loading
# the same model in the build environment, and unverified enforcement is
# not shippable for this contract. Pinned to the SAME llama.cpp commit
# the eval ran.
#
# The model is NOT in this image (the 4.7 GB flag): it is a GGUF file
# the compose mounts read-only from appliance/models/ — shipped
# alongside, sha256-pinned to the official Qwen release.
#
# Two runtime targets — compose picks via LLAMA_RUNTIME:
#   runtime-cpu  — CPU inference (testing; slow: the eval measured
#                  60–63 s cold / ~7–14 s warm on 4 vCPU)
#   runtime-cuda — the GPU path (the validator's RTX 4060). Build is
#                  verified in Package CI; RUNTIME needs GPU hardware,
#                  which the build environment does not have — flagged.

FROM ubuntu:24.04 AS build-cpu
ARG LLAMA_COMMIT=e8f19cc0ad70a243c8012bf17b4be601abfc8ea2
RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential cmake curl ca-certificates libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/ggml-org/llama.cpp /src \
    && cd /src && git checkout ${LLAMA_COMMIT}
WORKDIR /src
RUN cmake -B build -DGGML_CUDA=OFF -DBUILD_SHARED_LIBS=OFF \
      -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF \
    && cmake --build build --target llama-server -j"$(nproc)"

FROM nvidia/cuda:12.4.1-devel-ubuntu22.04 AS build-cuda
ARG LLAMA_COMMIT=e8f19cc0ad70a243c8012bf17b4be601abfc8ea2
RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential cmake curl ca-certificates libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/ggml-org/llama.cpp /src \
    && cd /src && git checkout ${LLAMA_COMMIT}
WORKDIR /src
RUN cmake -B build -DGGML_CUDA=ON -DBUILD_SHARED_LIBS=OFF \
      -DCMAKE_CUDA_ARCHITECTURES=89 \
      -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF \
    && cmake --build build --target llama-server -j"$(nproc)"

FROM ubuntu:24.04 AS runtime-cpu
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates libgomp1 libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build-cpu /src/build/bin/llama-server /usr/local/bin/llama-server
EXPOSE 8081
ENTRYPOINT ["/usr/local/bin/llama-server"]

FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04 AS runtime-cuda
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates libgomp1 libcurl4 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build-cuda /src/build/bin/llama-server /usr/local/bin/llama-server
EXPOSE 8081
ENTRYPOINT ["/usr/local/bin/llama-server"]
