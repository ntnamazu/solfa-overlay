FROM node:20

ARG TZ
ENV TZ="$TZ"

ARG CLAUDE_CODE_VERSION=latest

# Install basic development tools and iptables/ipset
RUN apt-get update && apt-get install -y --no-install-recommends \
  less \
  git \
  procps \
  sudo \
  fzf \
  zsh \
  man-db \
  unzip \
  gnupg2 \
  gh \
  iptables \
  ipset \
  iproute2 \
  dnsutils \
  aggregate \
  jq \
  nano \
  vim \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Electron (Chromium) の実行に必要なシステムライブラリ
# devcontainer 内で `npm run dev` するために必要（WSLg の Wayland 転送で画面表示する）
# fonts-noto-cjk はウィンドウ内の日本語表示用（無いと豆腐になる）
RUN apt-get update && apt-get install -y --no-install-recommends \
  libnss3 \
  libnspr4 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libgtk-3-0 \
  libgbm1 \
  libasound2 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libxkbcommon0 \
  fonts-noto-cjk \
  && apt-get clean && rm -rf /var/lib/apt/lists/*
# ※ コンテナ内での Chromium サンドボックス無効化（--no-sandbox）と Wayland 明示
#   （--ozone-platform=wayland、X11 転送経由は起動デッドロックするため）は
#   scripts/dev.mjs が実行時に判定して付与する
#   （環境変数は VS Code ターミナルまで伝播しないことがあるため）

# Audiveris（OMR エンジン）を devcontainer に同梱する
# - devcontainer 内で `npm run dev` して OMR まで一気通貫を回せるようにするための開発用途。
#   配布物への同梱（scripts/fetch-resources.ts / electron-builder）とは別レイヤー。
# - テストフィクスチャと同一の 5.6.1 に「バージョン＋SHA-256 固定」（architecture.md の
#   「audiveris は完全固定」方針）。JRE は入れない（この .deb は jpackage 製で
#   OpenJDK 21 ランタイムを同梱。現行コンテナで headless 実行を実証済み）。
# - .deb は /opt/audiveris 配下のみを配置する（/usr は触らないため衝突なし・確認済み）。
#   依存解決を伴わない dpkg-deb -x で展開し、PATH 解決名 `audiveris` を symlink する
#   （OmrRunner の既定パス解決 = `audiveris` がそのまま通る）。
# - firewall（init-firewall.sh）は postStartCommand で、docker build 時は非アクティブ。
#   ビルド時の GitHub からの取得は成功する。実行時の OMR はローカル処理でネット不要。
ARG AUDIVERIS_VERSION=5.6.1
ARG AUDIVERIS_SHA256=3f05c33fe65a5fced51718bdafde9ed989528b882cf3297d4c72b588ef04a656
RUN AUDIVERIS_DEB="Audiveris-${AUDIVERIS_VERSION}-ubuntu22.04-x86_64.deb" \
  && wget -q "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/${AUDIVERIS_DEB}" \
  && echo "${AUDIVERIS_SHA256}  ${AUDIVERIS_DEB}" | sha256sum -c - \
  && dpkg-deb -x "${AUDIVERIS_DEB}" / \
  && ln -s /opt/audiveris/bin/Audiveris /usr/local/bin/audiveris \
  && rm "${AUDIVERIS_DEB}"

# Ensure default node user has access to /usr/local/share
RUN mkdir -p /usr/local/share/npm-global && \
  chown -R node:node /usr/local/share

ARG USERNAME=node

# Persist bash history.
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  && mkdir /commandhistory \
  && touch /commandhistory/.bash_history \
  && chown -R $USERNAME /commandhistory

# Set `DEVCONTAINER` environment variable to help with orientation
ENV DEVCONTAINER=true

# Create workspace and config directories and set permissions
RUN mkdir -p /workspace /home/node/.claude /home/node/.config && \
  chown -R node:node /workspace /home/node/.claude /home/node/.config

WORKDIR /workspace

ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \
  wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  sudo dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# Set up non-root user
USER node

# Install global packages
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Set the default shell to zsh rather than sh
ENV SHELL=/bin/zsh

# Set the default editor and visual
ENV EDITOR=nano
ENV VISUAL=nano

# Default powerline10k theme
ARG ZSH_IN_DOCKER_VERSION=1.2.0
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
  -p git \
  -p fzf \
  -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \
  -a "source /usr/share/doc/fzf/examples/completion.zsh" \
  -a "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  -x

# Install Claude
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}


# Copy and set up firewall script
COPY init-firewall.sh /usr/local/bin/
USER root
RUN chmod +x /usr/local/bin/init-firewall.sh && \
  echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall && \
  chmod 0440 /etc/sudoers.d/node-firewall
USER node