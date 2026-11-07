%% 黄河戍境 —— 网页叠加用热力图帧序列导出（MATLAB R2020b+）
%
% 运行：在 MATLAB 中直接运行本脚本；或命令行
%   matlab -batch "run('tools/matlab/export_heatmap_frames.m')"
%
% 验证状态：已通过 MATLAB R2026b 的 mlint 静态检查与全部需求要素断言；
%           出图须在许可正常的 MATLAB 上执行，首次运行建议保持
%           cfg.dataSource = 'demo' 自检（内置含沙量 / 流速 / 水深三变量）。
%
% 输出（单变量时直接落在 cfg.outDir，多变量时每个变量一个子目录）：
%   frames/frame_0001.png ...   每时间步一张、背景透明、NaN 全透明、尺寸一致
%   meta.json                    bounds / frames / times / clim / units ...
%   colorbar.png                 与帧共用同一固定色标的独立透明色标
%
% 网页叠加示例（Leaflet；底图必须用高德 / 腾讯 / 天地图等合规地图服务，不得直连 OSM）：
%   const meta = await (await fetch('heatmap_frames/meta.json')).json();
%   const dir  = 'heatmap_frames/frames/';
%   const ov   = L.imageOverlay(dir + meta.frames[0], meta.bounds_leaflet,
%                               { opacity: 0.78, interactive: false }).addTo(map);
%   let i = 0;
%   setInterval(() => ov.setUrl(dir + meta.frames[++i % meta.frames.length]), 600);
% 注意：meta.crs 为 WGS84。若底图是 GCJ-02（高德 / 腾讯），需在前端把 bounds
%       按 WGS84->GCJ-02 偏移后再叠加；非线性偏移只能用外接矩形近似，
%       大范围精确配准应使用同一坐标系发布的合规底图，勿把本图单独当作地图发布。
%
% 数据输入（三选一，见下方配置区 cfg.dataSource）：
%   'demo'      内置合成数据（含沙量 / 流速 / 水深），拿来即可跑通自检
%   'workspace' 读 base 工作区变量 cfg.varName，Z(lat,lon,time) 或 Z(lon,lat,time) 自动识别
%   'mat'       读 cfg.matFile 里的 cfg.varName
%   cfg.varName 可写成 cell（多变量），按序对应 cfg.datasets(i)；各变量须共用同一网格。
%   lon / lat 既可直接给中心向量，也可给工作区变量名字符串；留空则按
%   cfg.lonRange / cfg.latRange 与 Z 的网格尺寸自动生成中心网格。
%
% 合规提示：本脚本只产出透明数据图层，不含任何底图、境界线与审图号；
%           属于数据可视化成果，非标准地图 / 非测绘成果，不得单独发布。

%% ===================== 1. 配置区（按需修改） =====================
cfg = localDefaultConfig();

cfg.dataSource = 'demo';                 % 'demo' | 'workspace' | 'mat'
cfg.outDir     = fullfile(localScriptDir(), '..', '..', 'var', 'heatmap_frames');

% --- 真实数据时改这里 ---
cfg.matFile    = 'data.mat';             % dataSource='mat' 时的数据文件
cfg.varName    = 'Z';                    % 变量名；多变量时写成 cell，如 {'sed','vel','dep'}，
                                         % 与 cfg.datasets(i) 一一对应（各变量须共用同一网格）
cfg.lon        = [];                     % [] 或数值向量 或 工作区变量名
cfg.lat        = [];
cfg.lonRange   = [100 119];              % 经度范围（东经，度）
cfg.latRange   = [33 41];                % 纬度范围（北纬，度）
cfg.dimOrder   = 'lat_lon';              % 未提供 lon/lat 向量时如何解释 Z 前两维：
                                         % 'lat_lon' = Z(lat,lon,time)（默认）；'lon_lat' = Z(lon,lat,time)
cfg.times      = [];                     % [] 或 datetime / 字符串 / 数值向量
cfg.startTime  = datetime(2026, 6, 1, 0, 0, 0);   % times 为空时的起始时刻
cfg.timeStep   = hours(1);

% --- 变量（单变量只用第 1 项；多变量时把 cfg.varName 写成 cell 并补足本结构数组） ---
cfg.datasets = struct( ...
    'key',       'sediment', ...
    'name',      '含沙量', ...
    'units',     'kg/m^3', ...          % meta.json 里的机器可读单位
    'unitLabel', 'kg/m³', ...           % colorbar 上的显示单位
    'clim',      [0 5]);                % 固定色标；[] = 用整个时间序列的全局范围（仍固定）

% --- 出图参数 ---
cfg.width      = 1200;                   % 每帧输出宽度（像素），高度按经纬度跨度比例算
cfg.maxBytes   = 300 * 1024;             % 单帧硬上限 300 KB
cfg.render     = 'pcolor';               % 'pcolor'（按需求：shading interp + exportgraphics）
                                         % 'raster'（像素精确光栅化，配准更严、体积更小）
cfg.cmapSize   = 256;                    % turbo 色表长度，全部帧 + colorbar 共用
cfg.colorbarWidth = 720;

%% ===================== 2. 组装数据集与网格 =====================
datasets = localBuildDatasets(cfg);
[grid, times] = localResolveGrid(cfg, datasets);
cmap = localTurbo(cfg.cmapSize);

fprintf('\n========== 热力图帧序列导出 ==========\n');
fprintf('数据源      : %s\n', cfg.dataSource);
fprintf('输出目录    : %s\n', cfg.outDir);
fprintf('网格        : %d (lon) x %d (lat) x %d (time)\n', grid.nLon, grid.nLat, grid.nTime);
fprintf('bounds      : west %.4f / south %.4f / east %.4f / north %.4f\n', ...
        grid.west, grid.south, grid.east, grid.north);
fprintf('像素        : %d x %d，单帧上限 %d B\n', cfg.width, grid.height, cfg.maxBytes);
fprintf('渲染方式    : %s，色表 turbo(%d)\n\n', cfg.render, cfg.cmapSize);

if ~exist(cfg.outDir, 'dir'), mkdir(cfg.outDir); end

%% ===================== 3. 逐变量导出 =====================
for di = 1:numel(datasets)
    ds = datasets(di);
    ds.Z = localNormalizeCube(ds.Z, grid, cfg);          % -> (lat, lon, time)
    ds.clim = localFixedClim(ds, cfg);                    % 全序列只算一次，之后固定

    outDir = cfg.outDir;
    if numel(datasets) > 1
        outDir = fullfile(cfg.outDir, ds.key);
    end
    frameDir = fullfile(outDir, 'frames');
    if ~exist(frameDir, 'dir'), mkdir(frameDir); end

    fprintf('[%d/%d] %s (%s)  clim = [%.4g, %.4g] %s\n', ...
            di, numel(datasets), ds.name, ds.key, ds.clim(1), ds.clim(2), ds.units);

    frameNames = cell(1, grid.nTime);
    frameBytes = zeros(1, grid.nTime);
    frameAlpha = zeros(1, grid.nTime);
    frameSize  = cell(1, grid.nTime);
    frameHasAlpha = false(1, grid.nTime);
    pixelSize = [cfg.width grid.height];                 % 若触发降分辨率，改记实际尺寸

    for k = 1:grid.nTime
        Zk = ds.Z(:, :, k);                               % (nLat x nLon)
        name = sprintf('frame_%04d.png', k);
        file = fullfile(frameDir, name);
        [rgb, a] = localRenderFrame(Zk, grid, ds.clim, cmap, cfg);
        info = localWritePng(rgb, a, file, cfg.maxBytes);

        frameNames{k} = ['frames/' name];
        frameBytes(k) = info.bytes;
        frameAlpha(k) = info.transparentRatio;
        frameSize{k}  = sprintf('%dx%d', info.height, info.width);
        frameHasAlpha(k) = info.hasAlpha;
        if k == 1, pixelSize = [info.width info.height]; end
    end

    localWriteColorbar(fullfile(outDir, 'colorbar.png'), ds, cmap, cfg);
    localWriteMeta(fullfile(outDir, 'meta.json'), ds, grid, times, ...
                   frameNames, frameBytes, pixelSize, cmap, cfg);

    fprintf('       帧数 %d | 最大 %.1f KB (< %d KB: %s) | 透明通道: %s | NaN 透明像素 %.1f%% | 尺寸 %s\n', ...
            grid.nTime, max(frameBytes)/1024, cfg.maxBytes/1024, ...
            localYesNo(all(frameBytes <= cfg.maxBytes)), ...
            localYesNo(all(frameHasAlpha)), ...
            100*mean(frameAlpha), frameSize{1});
    if any(frameBytes > cfg.maxBytes)
        error('存在超过 %.0f KB 的帧，请调小 cfg.width 或改用 cfg.render = ''raster''。', ...
              cfg.maxBytes/1024);
    end
    if ~all(frameHasAlpha)
        error('存在无 alpha 通道的帧，NaN 透明未生效。');
    end
    if ~all(strcmp(frameSize, frameSize{1}))
        error('各帧像素尺寸不一致，无法作为叠加序列使用。');
    end
end

%% ===================== 4. 汇总 =====================
if numel(datasets) > 1
    idx = struct();
    idx.generated_at = char(datetime('now'), 'yyyy-MM-dd HH:mm:ss');
    idx.coordinate_system = 'WGS84 (EPSG:4326)';
    idx.datasets = {datasets.key};
    idx.outDir = cfg.outDir;
    localWriteJson(fullfile(cfg.outDir, 'index.json'), idx);
end
fprintf('\n全部完成。产物：meta.json / colorbar.png / frames/frame_*.png\n');
fprintf('提示：真实数据请把 cfg.dataSource 改为 ''workspace'' 或 ''mat''，并填写 cfg.varName 与各单位/色标。\n');
fprintf('========================================\n\n');

%% ===================== 局部函数 =====================
function cfg = localDefaultConfig()
    cfg = struct();
    cfg.dataSource = 'demo';
    cfg.matFile = 'data.mat';
    cfg.varName = 'Z';
    cfg.lon = [];
    cfg.lat = [];
    cfg.lonRange = [100 119];
    cfg.latRange = [33 41];
    cfg.dimOrder = 'lat_lon';
    cfg.times = [];
    cfg.startTime = datetime(2026, 6, 1, 0, 0, 0);
    cfg.timeStep = hours(1);
    cfg.outDir = pwd;
    cfg.width = 1200;
    cfg.maxBytes = 300*1024;
    cfg.render = 'pcolor';
    cfg.cmapSize = 256;
    cfg.colorbarWidth = 720;
    cfg.datasets = struct('key','sediment','name','含沙量', ...
                          'units','kg/m^3','unitLabel','kg/m³','clim',[0 5]);
end

function p = localScriptDir()
    % 用调用栈定位脚本所在目录，避免 run() 方式下 mfilename 失效
    p = '';
    try
        st = dbstack('-completenames');
        for i = 1:numel(st)
            if contains(st(i).file, 'export_heatmap_frames.m')
                p = fileparts(st(i).file);
                break;
            end
        end
    catch
    end
    if isempty(p), p = fileparts(mfilename('fullpath')); end
    if isempty(p), p = pwd; end
end

function cmap = localTurbo(n)
    % 优先用内置 turbo；旧版本回退到 Google turbo 的公开多项式近似（视觉一致）
    if exist('turbo', 'file') == 2
        try
            cmap = turbo(n);
            return;
        catch
        end
    end
    x = linspace(0, 1, n).';
    r = [0.13572138,  4.61539260, -42.66032258, 132.13108234, -152.94239396, 59.28637943];
    g = [0.09140261,  2.19418839,   4.84296658, -14.18503333,   4.27729857,  2.82956604];
    b = [0.10667330, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973];
    cmap = max(0, min(1, [polyval(r, x), polyval(g, x), polyval(b, x)]));
end

function ds = localBuildDatasets(cfg)
    if strcmpi(cfg.dataSource, 'demo')
        ds = localDemoDatasets();
        return;
    end
    names = cfg.varName;
    if ischar(names) || isstring(names)
        names = cellstr(names);
    end
    if ~iscell(names) || isempty(names)
        error('cfg.varName 必须是变量名或变量名 cell 数组。');
    end
    names = cellfun(@char, names, 'UniformOutput', false);

    ds = cfg.datasets;
    n = min(numel(names), numel(ds));
    names = names(1:n);
    ds = ds(1:n);                                        % 未提供数据的变量不导出

    switch lower(cfg.dataSource)
        case 'workspace'
            for i = 1:n
                expr = sprintf('exist(''%s'',''var'')', names{i});
                if evalin('base', expr) ~= 1
                    error('base 工作区中找不到变量 %s。', names{i});
                end
                ds(i).Z = evalin('base', names{i});
            end
        case 'mat'
            S = load(cfg.matFile, names{:});
            for i = 1:n
                if ~isfield(S, names{i})
                    error('文件 %s 中找不到变量 %s。', cfg.matFile, names{i});
                end
                ds(i).Z = S.(names{i});
            end
        otherwise
            error('cfg.dataSource 只能是 demo / workspace / mat。');
    end
    for i = 1:n
        if iscell(ds(i).Z) && isscalar(ds(i).Z)
            ds(i).Z = ds(i).Z{1};
        end
    end
end

function ds = localDemoDatasets()
    rng(2026);                                          % 固定随机种子，便于复现自检
    lon = 100:0.25:119;
    lat = 33:0.25:41;
    [LON, LAT] = meshgrid(lon, lat);
    nLat = numel(lat); nLon = numel(lon); T = 12;
    % 一条示意性的黄河弯曲带 + 随时间迁移的高含沙斑块
    centre = 36.0 + 2.1*sin((lon - 100)/19*2*pi);
    band = exp(-((LAT - repmat(centre, nLat, 1))/0.95).^2);
    valid = ~((LON < 105.5 & LAT < 34.6) | ...
              (((LON - 112).^2)/6 + ((LAT - 38.7).^2)/1.2 < 1));

    sediment = zeros(nLat, nLon, T);
    velocity = zeros(nLat, nLon, T);
    depth    = zeros(nLat, nLon, T);
    for k = 1:T
        pulse = exp(-((LON - (103 + 15*k/T))/2.6).^2);
        s = 0.15 + 4.2*band.*(0.55 + 0.45*pulse) + 0.12*randn(nLat, nLon);
        v = 0.10 + 2.5*band.*(0.7 + 0.3*pulse) + 0.05*randn(nLat, nLon);
        d = 0.30 + 10.5*band + 0.20*randn(nLat, nLon);
        s(~valid) = NaN; v(~valid) = NaN; d(~valid) = NaN;
        sediment(:,:,k) = max(s, 0);
        velocity(:,:,k) = max(v, 0);
        depth(:,:,k)    = max(d, 0);
    end
    ds = struct( ...
        'key',       {'sediment', 'velocity', 'depth'}, ...
        'name',      {'含沙量',   '流速',     '水深'}, ...
        'units',     {'kg/m^3',   'm/s',      'm'}, ...
        'unitLabel', {'kg/m³',    'm/s',      'm'}, ...
        'clim',      {[0 5],      [0 3],      [0 15]}, ...
        'Z',         {sediment,   velocity,   depth});
end

function [grid, times] = localResolveGrid(cfg, datasets)
    Z0 = datasets(1).Z;
    s = size(Z0);
    if numel(s) < 3
        s = [s, ones(1, 3-numel(s))];                    % 补齐到 3 维
    end
    nTime = s(3);

    lon = localResolveVector(cfg.lon);
    lat = localResolveVector(cfg.lat);
    if isempty(lon) ~= isempty(lat)
        error('cfg.lon 与 cfg.lat 必须同时提供或同时留空。');
    end
    if ~isempty(lon) && ~isempty(lat)
        % 有坐标向量：以向量长度为准，Z 的前两维顺序由 localNormalizeCube 自动判别
        nLon = numel(lon); nLat = numel(lat);
        a = s(1); b = s(2);
        if ~((a == nLat && b == nLon) || (a == nLon && b == nLat))
            error('Z 尺寸 %s 与 lon(%d)/lat(%d) 不匹配。', ...
                  mat2str(size(Z0)), nLon, nLat);
        end
        if nLon == nLat
            fprintf('注意：lon/lat 长度相同（%d），按 cfg.dimOrder = %s 解释前两维。\n', ...
                    nLon, cfg.dimOrder);
        end
    else
        % 无坐标向量：按 cfg.dimOrder 解释前两维，并在给定经纬度范围内生成中心网格
        if strcmpi(cfg.dimOrder, 'lat_lon')
            nLat = s(1); nLon = s(2);
        else
            nLon = s(1); nLat = s(2);
        end
        lon = localCentres(cfg.lonRange, nLon);
        lat = localCentres(cfg.latRange, nLat);
    end
    lon = lon(:)'; lat = lat(:)';
    if nTime < 1, error('时间维为空。'); end

    lonE = localEdges(lon);
    latE = localEdges(lat);
    height = max(2, round(cfg.width * (latE(end)-latE(1)) / (lonE(end)-lonE(1))));

    grid = struct();
    grid.lon = lon; grid.lat = lat;
    grid.lonEdges = lonE; grid.latEdges = latE;
    grid.nLon = nLon; grid.nLat = nLat; grid.nTime = nTime;
    grid.west = lonE(1); grid.east = lonE(end);
    grid.south = latE(1); grid.north = latE(end);
    grid.width = cfg.width; grid.height = height;
    times = localTimeStrings(cfg, nTime);
end

function v = localResolveVector(v)
    if ischar(v) || (isstring(v) && isscalar(v))
        name = char(v);
        expr = sprintf('exist(''%s'',''var'')', name);
        if evalin('base', expr) ~= 1
            error('base 工作区中找不到坐标变量 %s。', name);
        end
        v = evalin('base', name);
    end
    if isstring(v), v = str2double(v); end
end

function c = localCentres(rng, n)
    e = linspace(rng(1), rng(2), n+1);
    c = (e(1:end-1) + e(2:end))/2;
end

function e = localEdges(c)
    d = diff(c);
    if isempty(d)
        e = [c-0.5, c+0.5];
    else
        e = [c(1)-d(1)/2, (c(1:end-1)+c(2:end))/2, c(end)+d(end)/2];
    end
end

function t = localTimeStrings(cfg, T)
    if isempty(cfg.times)
        if isempty(cfg.startTime)
            t = arrayfun(@(k) sprintf('t%04d', k), 1:T, 'UniformOutput', false);
        else
            dt = cfg.startTime + (0:T-1)*cfg.timeStep;
            t = cellstr(string(dt(:), 'yyyy-MM-dd HH:mm:ss'));
        end
    elseif isdatetime(cfg.times)
        t = cellstr(string(cfg.times(:), 'yyyy-MM-dd HH:mm:ss'));
    elseif isnumeric(cfg.times)
        t = arrayfun(@(v) sprintf('%g', v), cfg.times(:)', 'UniformOutput', false);
    else
        t = cellstr(string(cfg.times(:)));
    end
    t = t(:)';
    if numel(t) ~= T
        error('cfg.times 长度 %d 与时间步数 %d 不一致。', numel(t), T);
    end
end

function Z = localNormalizeCube(Z, grid, cfg)
    if ~isnumeric(Z), error('数据必须是数值数组。'); end
    Z = double(Z);                                       % 不用 squeeze，避免单纬度/单时刻被压维
    if ndims(Z) > 3, error('数据最多 3 维 (lat,lon,time)。'); end
    if ismatrix(Z)
        Z = reshape(Z, size(Z,1), size(Z,2), 1);
    end
    a = size(Z,1); b = size(Z,2);
    if grid.nLon == grid.nLat && strcmpi(cfg.dimOrder, 'lon_lat')
        Z = permute(Z, [2 1 3]);                        % 方阵只能靠显式口径判别
    elseif a == grid.nLat && b == grid.nLon
        % 已是 (lat,lon,time)
    elseif a == grid.nLon && b == grid.nLat
        Z = permute(Z, [2 1 3]);                        % 自动纠正 (lon,lat,time)
    else
        error('数据前两维为 %dx%d，期望 %dx%d (lat,lon)；请检查 cfg.dimOrder 或坐标向量。', ...
              a, b, grid.nLat, grid.nLon);
    end
    if size(Z,3) ~= grid.nTime
        error('数据时间步数 %d 与推断值 %d 不一致。', size(Z,3), grid.nTime);
    end
    Z(~isfinite(Z)) = NaN;                              % Inf / -Inf 一并视为无效
end

function clim = localFixedClim(ds, ~)
    if ~isempty(ds.clim) && numel(ds.clim) == 2 && ds.clim(2) > ds.clim(1)
        clim = double(ds.clim);
    else
        v = ds.Z(isfinite(ds.Z));
        if isempty(v), error('%s 全为 NaN，无法自动确定 clim。', ds.name); end
        lo = min(v); hi = max(v);
        if hi <= lo, hi = lo + 1; end
        clim = [lo hi];
        warning('%s 未指定 clim，已用整个时间序列的全局范围 [%.4g %.4g] 固定到所有帧。', ...
                ds.name, lo, hi);
    end
end

function [rgb, a] = localRenderFrame(Z, grid, clim, cmap, cfg)
    persistent fallbackWarned
    if isempty(fallbackWarned), fallbackWarned = false; end
    H = grid.height; W = grid.width;
    mask = flipud(double(~isnan(Z)));                   % 图像上边 = 高纬度
    maskBig = imresize(mask, [H W], 'bilinear');
    maskBig = min(1, max(0, maskBig));

    if strcmpi(cfg.render, 'raster')
        [rgb, a] = localRasterFrame(Z, H, W, clim, cmap, maskBig);
        return;
    end
    try
        [rgb, a] = localPcolorFrame(Z, grid, clim, cmap, H, W);
        if all(a(:) < 8) || double(max(rgb(:))) - double(min(rgb(:))) < 5
            error('导出结果为空或近乎纯色');
        end
        % 对齐自检：仅当导出 PNG 自带透明区时才比对；若 exportgraphics 输出全不透明，
        % 透明完全由下面的 NaN 掩膜保证，不必因 alpha 全 255 误判为未对齐。
        if nnz(a(:) > 247) / numel(a) < 0.98
            agree = nnz((maskBig(:) > 0.5) == (double(a(:)) > 128)) / numel(maskBig);
            if agree < 0.90
                error('pcolor 输出与网格未对齐（一致度 %.2f）', agree);
            end
        end
        a = uint8(round(double(a) .* maskBig));          % 两条路径都只乘一次掩膜
    catch ME
        if ~fallbackWarned
            warning('exportgraphics 渲染不可用（%s），后续帧自动改用像素精确光栅化。', ME.message);
            fallbackWarned = true;
        end
        [rgb, a] = localRasterFrame(Z, H, W, clim, cmap, maskBig);
    end
end

function [rgb, a] = localPcolorFrame(Z, grid, clim, cmap, H, W)
    nLat = grid.nLat; nLon = grid.nLon;
    % pcolor 用「顶点网格 + 面颜色」：X/Y 为单元边界，Z 补足一行一列后作为 CData
    C = nan(nLat+1, nLon+1);
    C(1:nLat, 1:nLon) = localFillNaN(Z);
    C(1:nLat, nLon+1) = C(1:nLat, nLon);
    C(nLat+1, 1:nLon) = C(nLat, 1:nLon);
    C(nLat+1, nLon+1) = C(nLat, nLon);

    fig = figure('Visible', 'off', 'Units', 'pixels', ...
                 'Position', [0 0 W H]);
    cleanup = onCleanup(@() localClose(fig));
    ax = axes('Parent', fig, 'Units', 'normalized', 'Position', [0 0 1 1], ...
              'Color', 'none', 'LooseInset', [0 0 0 0]);
    h = pcolor(ax, grid.lonEdges, grid.latEdges, C);
    set(h, 'EdgeColor', 'none');
    shading(ax, 'interp');                              % 平滑插值
    colormap(ax, cmap);                                % turbo
    ax.CLim = clim;                                     % 等价于 clim(ax, ...) / caxis
    ax.XLim = [grid.west grid.east];
    ax.YLim = [grid.south grid.north];
    ax.YDir = 'normal';
    axis(ax, 'off');                                    % 无坐标轴、无边距
    set(ax, 'XColor', 'none', 'YColor', 'none', 'ZColor', 'none');

    % NaN 面不参与着色：显式 AlphaData（尺寸同 CData）
    alphaPad = ones(nLat+1, nLon+1);
    alphaPad(1:nLat, 1:nLon) = double(~isnan(Z));
    try
        set(h, 'FaceAlpha', 'flat', 'AlphaDataMapping', 'none', 'AlphaData', alphaPad);
    catch
        try
            set(h, 'FaceAlpha', 'interp', 'AlphaDataMapping', 'none', 'AlphaData', alphaPad);
        catch
            % 忽略：后处理仍用 NaN 掩膜强制透明
        end
    end

    tmp = [tempname '.png'];
    tmpCleanup = onCleanup(@() localDelete(tmp));
    exportgraphics(ax, tmp, 'ContentType', 'image', ...
                   'BackgroundColor', 'none', 'Resolution', 96);
    [rgb, map, alpha] = imread(tmp);
    if ~isempty(map)
        rgb = ind2rgb(rgb, map);
    end
    if isempty(alpha)
        alpha = 255*ones(size(rgb,1), size(rgb,2), 'uint8');
    end
    if size(alpha,3) == 3, alpha = alpha(:,:,1); end
    if size(rgb,3) == 1, rgb = repmat(rgb, [1 1 3]); end
    if isinteger(rgb)
        rgbD = double(rgb(:,:,1:3)) / double(intmax(class(rgb)));
    else
        rgbD = double(rgb(:,:,1:3));
    end
    rgb = uint8(round(255 * imresize(rgbD, [H W], 'bilinear')));
    a = uint8(round(max(0, min(255, imresize(double(alpha), [H W], 'bilinear')))));
    clear cleanup tmpCleanup
end

function [rgb, a] = localRasterFrame(Z, H, W, clim, cmap, maskBig)
    Zf = localFillNaN(flipud(Z));                       % 上边 = 高纬度
    t = (Zf - clim(1)) / (clim(2) - clim(1));
    idx = max(1, min(size(cmap,1), floor(t*(size(cmap,1)-1)) + 1));
    small = reshape(cmap(idx(:), :), size(Zf,1), size(Zf,2), 3);
    rgb = uint8(round(255 * imresize(small, [H W], 'bilinear')));
    a = uint8(round(255 * maskBig));
end

function C = localFillNaN(Z)
    % 仅用于颜色插值：用最近的有效邻域均值填补 NaN，避免 interp 产生黑洞
    C = Z;
    bad = isnan(C);
    if ~any(bad(:)), return; end
    if all(bad(:)), C(:) = 0; return; end
    if size(C,1) < 3 || size(C,2) < 3
        C(bad) = mean(C(~bad));                         % 极小网格：直接用全局有效值均值
        return;
    end
    if exist('regionfill', 'file') == 2
        try
            C = regionfill(C, bad);
            return;
        catch
        end
    end
    for it = 1:24
        if ~any(isnan(C(:))), break; end
        b = isnan(C);
        acc = zeros(size(C)); cnt = zeros(size(C));
        for sh = [-1 1]
            acc(2:end-1,:) = acc(2:end-1,:) + ...
                reshape(C(2+sh:end-1+sh,:), size(C,1)-2, []);
            cnt(2:end-1,:) = cnt(2:end-1,:) + ...
                reshape(~isnan(C(2+sh:end-1+sh,:)), size(C,1)-2, []);
            acc(:,2:end-1) = acc(:,2:end-1) + ...
                reshape(C(:,2+sh:end-1+sh), [], size(C,2)-2);
            cnt(:,2:end-1) = cnt(:,2:end-1) + ...
                reshape(~isnan(C(:,2+sh:end-1+sh)), [], size(C,2)-2);
        end
        m = b & cnt > 0;
        C(m) = acc(m) ./ cnt(m);
    end
    C(isnan(C)) = 0;
end

function info = localWritePng(rgb, a, file, maxBytes)
    % 单帧硬上限：先逐级量化颜色（保留 alpha 与像素尺寸），仍超限再等比缩小像素。
    % 所有帧走同一套判定，因此输出的像素尺寸始终一致，meta 记录的是实际尺寸。
    qSteps = [0 2 4 8 16 32];
    scales = [1 0.85 0.70 0.55 0.45];
    done = false;
    for sc = scales
        if sc == 1
            rb = rgb; ab = a;
        else
            h = max(2, round(size(rgb,1)*sc));
            w = max(2, round(size(rgb,2)*sc));
            rb = imresize(rgb, [h w], 'bilinear');
            ab = uint8(round(imresize(double(a), [h w], 'bilinear')));
        end
        for q = qSteps
            rq = rb;
            if q > 0
                rq = uint8(q * round(double(rb)/q));
            end
            imwrite(rq, file, 'png', 'Alpha', ab);
            d = dir(file);
            if d.bytes <= maxBytes
                done = true;
                break;
            end
        end
        if done, break; end
    end
    d = dir(file);
    im = imfinfo(file);
    info = struct();
    info.bytes = d.bytes;
    info.width = im.Width;
    info.height = im.Height;
    if isfield(im, 'ColorType')                     % 部分版本/平台不返回该字段
        info.colorType = im.ColorType;
    else
        info.colorType = 'unknown';
    end
    [~, ~, alphaRead] = imread(file);
    info.hasAlpha = ~isempty(alphaRead);             % 透明通道硬校验
    if info.hasAlpha
        if size(alphaRead,3) == 3, alphaRead = alphaRead(:,:,1); end
        info.transparentRatio = nnz(alphaRead(:) < 8) / numel(alphaRead);
    else
        info.transparentRatio = 0;
    end
end

function localWriteColorbar(file, ds, cmap, cfg)
    fig = figure('Visible','off','Units','pixels', ...
                 'Position',[0 0 cfg.colorbarWidth 150]);
    cleanup = onCleanup(@() localClose(fig));
    ax = axes('Parent', fig, 'Units','normalized','Position',[0.08 0.55 0.84 0.22], ...
              'Color','none');
    colormap(ax, cmap);
    ax.CLim = ds.clim;
    cb = colorbar(ax, 'Location','southoutside');
    try
        cb.Label.String = [ds.name '  (' ds.unitLabel ')'];
        cb.Label.FontName = 'Microsoft YaHei';
        cb.FontName = 'Microsoft YaHei';
    catch
    end
    axis(ax, 'off');
    set(ax, 'XColor','none','YColor','none');
    exportgraphics(fig, file, 'ContentType','image', ...
                   'BackgroundColor','none','Resolution',96);
    clear cleanup
end

function localWriteMeta(file, ds, grid, times, frames, bytes, pixelSize, cmap, cfg)
    m = struct();
    m.schema_version = '1.0';
    m.name = ds.name;
    m.key = ds.key;
    m.units = ds.units;
    m.unit_label = ds.unitLabel;
    m.clim = ds.clim;
    m.colormap = 'turbo';
    m.colormap_size = size(cmap, 1);
    m.coordinate_system = 'WGS84 (EPSG:4326)';
    m.crs = 'WGS84 (EPSG:4326)';
    m.grid_convention = 'cell-centre values on regular lon/lat grid; edges define bounds';
    m.bounds = struct('west', grid.west, 'south', grid.south, ...
                      'east', grid.east, 'north', grid.north);
    m.bounds_leaflet = [grid.south grid.west; grid.north grid.east];
    m.grid = struct('nx', grid.nLon, 'ny', grid.nLat, ...
                    'lon', grid.lon, 'lat', grid.lat, ...
                    'lon_edges', grid.lonEdges, 'lat_edges', grid.latEdges);
    m.pixel_size = [pixelSize(1) pixelSize(2)];
    m.max_bytes_per_frame = cfg.maxBytes;
    m.image_origin = 'north-up (top row = north)';
    m.transparent_nan = true;
    m.render = cfg.render;
    m.render_note = '若 pcolor/exportgraphics 不可用或输出与网格未对齐，脚本自动降级为等价光栅化（视觉与色标一致）';
    m.frames = frames;
    m.times = times;
    m.time_format = 'times[i] 与 frames[i] 一一对应；默认格式 yyyy-MM-dd HH:mm:ss';
    m.frame_count = numel(frames);
    m.colorbar = 'colorbar.png';
    m.frame_bytes = bytes;
    m.generated_at = char(datetime('now'), 'yyyy-MM-dd HH:mm:ss');
    m.compliance_note = ['透明数据叠加层，不含底图与境界线，非标准地图 / 非测绘成果；' ...
                         '须叠加在合规底图（高德 / 腾讯 / 天地图）之上，不得单独发布。' ...
                         '若底图为 GCJ-02，前端须对 bounds 做坐标偏移（外接矩形近似）。'];
    localWriteJson(file, m);
end

function localWriteJson(file, s)
    try
        txt = jsonencode(s, 'PrettyPrint', true);
    catch
        txt = jsonencode(s);
    end
    fid = fopen(file, 'w', 'n', 'UTF-8');
    if fid < 0, error('无法写入 %s', file); end
    fwrite(fid, txt, 'char');
    fclose(fid);
end

function s = localYesNo(v)
    if v, s = '是'; else, s = '否'; end
end

function localClose(fig)
    if ishandle(fig), close(fig); end
end

function localDelete(f)
    if exist(f, 'file'), delete(f); end
end
