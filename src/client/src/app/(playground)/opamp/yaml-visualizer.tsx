"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Agent } from "@/types/opamp";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { jsonStringify } from "@/utils/json";
import { useState, useCallback, useRef, useEffect } from "react";

// TypeScript interfaces
interface ParsedYamlObject {
  [key: string]: any;
}

interface GroupColor {
  bg: string;
  border: string;
  text: string;
}

interface GroupItem {
  key: string;
  value: string;
  type: "property" | "array" | "object" | "array-item" | "primitive";
}

interface Group {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  items: GroupItem[];
  level: number;
  color: GroupColor;
  yamlLineIndex: number;
}

interface Connection {
  id: string;
  from: string;
  to: string;
}

interface DiagramData {
  groups: Group[];
  connections: Connection[];
}

interface DragState {
  isDragging: boolean;
  groupId: string | null;
  startX: number;
  startY: number;
}

interface PanState {
  isPanning: boolean;
  startX: number;
  startY: number;
  startViewX: number;
  startViewY: number;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

interface YamlVisualizerProps {
  agent: Agent;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  instanceId: string;
  fetchAgentInfo: () => void;
}

// YAML parser function
const parseYAML = (yamlString: string): ParsedYamlObject => {
  try {
    const lines = yamlString.split("\n").filter((line: string) => line.trim());
    const result: ParsedYamlObject = {};
    const stack: Array<{ obj: ParsedYamlObject; indent: number }> = [{ obj: result, indent: -1 }];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const indent = line.length - line.trimStart().length;
      const colonIndex = trimmed.indexOf(":");

      if (colonIndex === -1) continue;

      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).trim();

      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const parent = stack[stack.length - 1].obj;

      if (value === "" || value === "{}" || value === "[]") {
        parent[key] = {};
        stack.push({ obj: parent[key], indent });
      } else if (value.startsWith("-")) {
        if (!Array.isArray(parent[key])) parent[key] = [];
        parent[key].push(value.substring(1).trim());
      } else {
        parent[key] = value;
      }
    }

    return result;
  } catch (error: any) {
    throw new Error(`YAML parsing error: ${error?.message || 'Unknown error'}`);
  }
};

// Convert YAML to grouped nodes with horizontal layout and collision detection
const yamlToGroupedNodes = (
  yamlObj: ParsedYamlObject,
  parentId: string | null = null,
  x = 50,
  y = 50,
  level = 0,
  yamlLines: string[] = []
): DiagramData => {
  const groups: Group[] = [];
  const connections: Connection[] = [];
  const groupWidth = 280;
  const horizontalSpacing = 350;
  const verticalSpacing = 200;
  const minVerticalGap = 50;

  const colors: { [key: number]: GroupColor } = {
    0: { bg: "#1e293b", border: "#334155", text: "#94a3b8" },
    1: { bg: "#0f172a", border: "#1e293b", text: "#64748b" },
    2: { bg: "#0c1426", border: "#1e293b", text: "#475569" },
  };

  // Track occupied positions to prevent overlaps
  const occupiedPositions: Array<{ x: number; y: number; width: number; height: number }> = [];

  const findAvailablePosition = (preferredX: number, preferredY: number, width: number, height: number) => {
    let testX = preferredX;
    let testY = preferredY;
    let attempts = 0;
    const maxAttempts = 20;

    while (attempts < maxAttempts) {
      let hasOverlap = false;

      for (const occupied of occupiedPositions) {
        // Check for overlap with padding
        const padding = 20;
        if (testX < occupied.x + occupied.width + padding &&
          testX + width + padding > occupied.x &&
          testY < occupied.y + occupied.height + padding &&
          testY + height + padding > occupied.y) {
          hasOverlap = true;
          break;
        }
      }

      if (!hasOverlap) {
        occupiedPositions.push({ x: testX, y: testY, width, height });
        return { x: testX, y: testY };
      }

      // Try different positions
      if (attempts < 10) {
        // First try moving down
        testY += minVerticalGap;
      } else {
        // Then try moving right and reset Y
        testX += horizontalSpacing * 0.5;
        testY = preferredY;
      }

      attempts++;
    }

    // Fallback: use preferred position even if it overlaps
    occupiedPositions.push({ x: preferredX, y: preferredY, width, height });
    return { x: preferredX, y: preferredY };
  };

  const processLevel = (
    obj: ParsedYamlObject,
    currentLevel: number,
    startX: number,
    startY: number,
    parentGroupId: string | null = null
  ) => {
    let currentX = startX;
    let maxYUsed = startY;

    Object.entries(obj).forEach(([key, value], index) => {
      const groupId = parentGroupId ? `${parentGroupId}-${key}` : key;
      const groupColor = colors[currentLevel % 3];

      // Find the line number for this key in the YAML
      const keyLineIndex = yamlLines.findIndex(
        (line: string) => line.trim().startsWith(key + ":") &&
          line.length - line.trimStart().length === currentLevel * 2
      );

      // Calculate group contents
      const items: GroupItem[] = [];

      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        Object.entries(value).forEach(([childKey, childValue]) => {
          if (typeof childValue === "string" || typeof childValue === "number" || typeof childValue === "boolean") {
            items.push({
              key: childKey,
              value: String(childValue),
              type: "property",
            });
          } else if (Array.isArray(childValue)) {
            items.push({
              key: childKey,
              value: `(${childValue.length} items)`,
              type: "array",
            });
          } else {
            items.push({
              key: childKey,
              value: `(${typeof childValue === 'object' && childValue !== null ? Object.keys(childValue).length : 0} keys)`,
              type: "object",
            });
          }
        });
      } else if (Array.isArray(value)) {
        value.forEach((item, idx) => {
          items.push({
            key: idx.toString(),
            value: String(item),
            type: "array-item",
          });
        });
      } else {
        items.push({
          key: "value",
          value: String(value),
          type: "primitive",
        });
      }

      // Calculate group height based on items
      const headerHeight = 50;
      const itemHeight = 28;
      const padding = 20;
      const groupHeight = Math.max(140, headerHeight + items.length * itemHeight + padding * 2);

      // Find available position for this group
      const preferredY = startY + (currentLevel * verticalSpacing);
      const position = findAvailablePosition(currentX, preferredY, groupWidth, groupHeight);

      // Create group
      groups.push({
        id: groupId,
        title: key,
        x: position.x,
        y: position.y,
        width: groupWidth,
        height: groupHeight,
        items: items,
        level: currentLevel,
        color: groupColor,
        yamlLineIndex: keyLineIndex,
      });

      // Create connection from parent
      if (parentGroupId) {
        connections.push({
          id: `${parentGroupId}-${groupId}`,
          from: parentGroupId,
          to: groupId,
        });
      }

      // Track the maximum Y used
      maxYUsed = Math.max(maxYUsed, position.y + groupHeight);

      // Process nested objects
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const nestedObjects = Object.entries(value).filter(
          ([k, v]) => typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0
        );

        if (nestedObjects.length > 0) {
          const nestedStartX = position.x + horizontalSpacing;
          const nestedStartY = position.y;

          nestedObjects.forEach(([nestedKey, nestedValue]) => {
            processLevel({ [nestedKey]: nestedValue }, currentLevel + 1, nestedStartX, nestedStartY, groupId);
          });
        }
      }

      // Update currentX for next sibling at same level
      currentX = position.x + groupWidth + horizontalSpacing;
    });

    return maxYUsed;
  };

  // Start processing from the root level
  processLevel(yamlObj, level, x, y, parentId);

  return { groups, connections };
};

interface GroupNodeProps {
  group: Group;
  isDragging: boolean;
  isSelected: boolean;
  isHovered: boolean;
  onMouseDown: (e: React.MouseEvent, group: Group) => void;
  onGroupClick: (group: Group) => void;
  onGroupHover: (groupId: string | null) => void;
  transform: Transform;
}

const GroupNode: React.FC<GroupNodeProps> = ({
  group,
  isDragging,
  isSelected,
  isHovered,
  onMouseDown,
  onGroupClick,
  onGroupHover,
  transform
}) => {
  const { title, x, y, width, height, items, color } = group;

  const handleClick = (e: React.MouseEvent) => {
    // Only trigger click if not dragging
    if (!isDragging) {
      e.stopPropagation();
      onGroupClick(group);
    }
  };

  const handleMouseEnter = () => {
    onGroupHover(group.id);
  };

  const handleMouseLeave = () => {
    onGroupHover(null);
  };

  // Calculate if the node is visible in the current viewport
  const nodeLeft = x * transform.scale + transform.x;
  const nodeTop = y * transform.scale + transform.y;
  const nodeRight = nodeLeft + width * transform.scale;
  const nodeBottom = nodeTop + height * transform.scale;

  // Skip rendering if completely outside viewport (with some padding)
  const padding = 100;
  if (nodeRight < -padding || nodeLeft > window.innerWidth + padding ||
    nodeBottom < -padding || nodeTop > window.innerHeight + padding) {
    return null;
  }

  // Determine text visibility based on zoom level
  const showDetailedText = transform.scale > 0.4;
  const showText = transform.scale > 0.2;

  // Dynamic styling based on state
  const getBorderColor = () => {
    if (isSelected) return "#3b82f6";
    if (isHovered) return "#22d3ee";
    return color.border;
  };

  const getBorderWidth = () => {
    if (isSelected) return "3";
    if (isHovered) return "2";
    return "1";
  };

  const getBackgroundColor = () => {
    if (isSelected) return "#1e3a8a";
    if (isHovered) return "#0f1629";
    return color.bg;
  };

  const getHeaderColor = () => {
    if (isSelected) return "#1e40af";
    if (isHovered) return "#164e63";
    return color.border;
  };

  return (
    <g
      className={`cursor-move transition-all duration-200 ${isDragging ? "opacity-75" : ""}`}
      onMouseDown={(e) => onMouseDown(e, group)}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Group background with enhanced styling */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={getBackgroundColor()}
        stroke={getBorderColor()}
        strokeWidth={getBorderWidth()}
        rx="8"
        className="drop-shadow-lg transition-all duration-200"
        filter={isSelected || isHovered ? "url(#glow)" : "none"}
      />

      {/* Header section */}
      <rect
        x={x}
        y={y}
        width={width}
        height="44"
        fill={getHeaderColor()}
        rx="8"
        className="opacity-60 transition-all duration-200"
      />

      {/* Title - always visible when text is shown */}
      {showText && (
        <text
          x={x + 16}
          y={y + 28}
          className={`font-semibold ${showDetailedText ? 'text-lg' : 'text-base'} pointer-events-none fill-white transition-all duration-200`}
        >
          {showDetailedText ? title : (title.length > 12 ? title.substring(0, 12) + "..." : title)}
        </text>
      )}

      {/* Connection indicator arrow */}
      {showText && (
        <text x={x + width - 25} y={y + 28} className="fill-gray-400 text-sm pointer-events-none">
          →
        </text>
      )}

      {/* Items - only show when zoomed in enough */}
      {showDetailedText && items.map((item, index) => {
        const itemY = y + 56 + index * 26;
        const isProperty = item.type === "property";
        const isArray = item.type === "array" || item.type === "array-item";

        return (
          <g key={`${group.id}-item-${index}`}>
            {/* Item background (subtle hover effect) */}
            <rect
              x={x + 8}
              y={itemY - 10}
              width={width - 16}
              height="24"
              fill="transparent"
              rx="3"
              className="hover:fill-white hover:fill-opacity-5 transition-all duration-150"
            />

            {/* Item key */}
            <text
              x={x + 12}
              y={itemY + 4}
              className={`text-sm font-medium pointer-events-none transition-all duration-200 ${isArray ? "fill-orange-400" : isProperty ? "fill-blue-400" : "fill-gray-300"
                }`}
            >
              {item.key}:
            </text>

            {/* Item value */}
            <text
              x={x + 12 + Math.min(item.key.length * 7 + 12, width * 0.4)}
              y={itemY + 4}
              className="fill-gray-300 text-sm pointer-events-none"
            >
              {item.value.length > 20 ? item.value.substring(0, 20) + "..." : item.value}
            </text>

            {/* Type indicator */}
            {(isArray || item.type === "object") && (
              <circle
                cx={x + width - 25}
                cy={itemY}
                r="4"
                fill={isArray ? "#f97316" : "#3b82f6"}
                className="opacity-70"
              />
            )}
          </g>
        );
      })}

      {/* Simplified view for low zoom levels */}
      {!showDetailedText && showText && items.length > 0 && (
        <text
          x={x + 16}
          y={y + 70}
          className="fill-gray-400 text-sm pointer-events-none"
        >
          {items.length} item{items.length !== 1 ? 's' : ''}
        </text>
      )}
    </g>
  );
};

interface ConnectionProps {
  connection: Connection;
  groups: Group[];
  isHighlighted: boolean;
  isHovered: boolean;
  onConnectionHover: (connectionId: string | null) => void;
  transform: Transform;
}

const Connection: React.FC<ConnectionProps> = ({
  connection,
  groups,
  isHighlighted,
  isHovered,
  onConnectionHover,
  transform
}) => {
  const fromGroup = groups.find((g) => g.id === connection.from);
  const toGroup = groups.find((g) => g.id === connection.to);

  if (!fromGroup || !toGroup) return null;

  // Skip rendering connections when zoomed out too much
  if (transform.scale < 0.3) return null;

  const fromX = fromGroup.x + fromGroup.width;
  const fromY = fromGroup.y + fromGroup.height / 2;
  const toX = toGroup.x;
  const toY = toGroup.y + toGroup.height / 2;

  // Create horizontal curved arrow path
  const controlOffset = Math.min(80, (toX - fromX) * 0.4);
  const pathData = `M ${fromX} ${fromY} C ${fromX + controlOffset} ${fromY}, ${toX - controlOffset} ${toY}, ${toX} ${toY}`;

  const getStrokeColor = () => {
    if (isHighlighted) return "#3b82f6";
    if (isHovered) return "#22d3ee";
    return "#475569";
  };

  const getStrokeWidth = () => {
    if (isHighlighted) return Math.max(2, 4 * transform.scale);
    if (isHovered) return Math.max(1.5, 3 * transform.scale);
    return Math.max(1, 2 * transform.scale);
  };

  const getOpacity = () => {
    if (isHighlighted || isHovered) return "1";
    return "0.7";
  };

  return (
    <g
      onMouseEnter={() => onConnectionHover(connection.id)}
      onMouseLeave={() => onConnectionHover(null)}
      className="cursor-pointer"
    >
      {/* Invisible thick line for better hover detection */}
      <path
        d={pathData}
        stroke="transparent"
        strokeWidth="12"
        fill="none"
        className="pointer-events-all"
      />

      {/* Visible connection line */}
      <path
        d={pathData}
        stroke={getStrokeColor()}
        strokeWidth={getStrokeWidth()}
        fill="none"
        markerEnd="url(#arrowhead)"
        className={`transition-all duration-200 pointer-events-none`}
        opacity={getOpacity()}
        filter={isHighlighted || isHovered ? "url(#connectionGlow)" : "none"}
      />
    </g>
  );
};

const YAMLDiagramVisualizer: React.FC<YamlVisualizerProps> = ({
  agent,
  onChange,
  readOnly = false,
  fetchAgentInfo,
  instanceId,
}) => {
  const [configType, setConfigType] = useState<"EffectiveConfig" | "CustomInstanceConfig">("EffectiveConfig");
  const [yamlInput, setYamlInput] = useState<string>(agent[configType] || "");

  const [groups, setGroups] = useState<Group[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState<string>("");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  const [hoveredConnection, setHoveredConnection] = useState<string | null>(null);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const [dragState, setDragState] = useState<DragState>({ isDragging: false, groupId: null, startX: 0, startY: 0 });
  const [panState, setPanState] = useState<PanState>({ isPanning: false, startX: 0, startY: 0, startViewX: 0, startViewY: 0 });
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 0.8 });
  const [contentBounds, setContentBounds] = useState({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 });

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const { fireRequest, isLoading } = useFetchWrapper();

  // Update internal state when yamlContent prop changes
  useEffect(() => {
    if (agent[configType] !== undefined) {
      setYamlInput(agent[configType]);
    }
  }, [agent[configType]]);

  const generateDiagram = useCallback(() => {
    try {
      setError("");
      const yamlLines = yamlInput.split("\n");
      const parsed = parseYAML(yamlInput);
      const diagramData = yamlToGroupedNodes(parsed, null, 50, 50, 0, yamlLines);
      setGroups(diagramData.groups);
      setConnections(diagramData.connections);

      if (diagramData.groups.length > 0) {
        const bounds = diagramData.groups.reduce(
          (acc, group) => ({
            minX: Math.min(acc.minX, group.x),
            minY: Math.min(acc.minY, group.y),
            maxX: Math.max(acc.maxX, group.x + group.width),
            maxY: Math.max(acc.maxY, group.y + group.height),
          }),
          {
            minX: Number.POSITIVE_INFINITY,
            minY: Number.POSITIVE_INFINITY,
            maxX: Number.NEGATIVE_INFINITY,
            maxY: Number.NEGATIVE_INFINITY,
          }
        );

        const padding = 100;
        setContentBounds({
          minX: bounds.minX - padding,
          minY: bounds.minY - padding,
          maxX: bounds.maxX + padding,
          maxY: bounds.maxY + padding,
        });
      }
    } catch (err: any) {
      setError(err?.message || 'Unknown error');
      setGroups([]);
      setConnections([]);
    }
  }, [yamlInput]);

  // Auto-update diagram when YAML input changes (debounced)
  useEffect(() => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }

    updateTimeoutRef.current = setTimeout(() => {
      generateDiagram();
    }, 500); // 500ms debounce

    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, [yamlInput, generateDiagram]);

  // Initial diagram generation
  useEffect(() => {
    generateDiagram();
  }, []);

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const scrollToLine = useCallback(
    (lineIndex: number) => {
      if (textareaRef.current && lineIndex >= 0) {
        const textarea = textareaRef.current;
        const lines = yamlInput.split("\n");

        // Calculate the character position of the line
        const lineStart = lines.slice(0, lineIndex).join("\n").length + (lineIndex > 0 ? 1 : 0);
        const lineEnd = lineStart + lines[lineIndex].length;

        // Set selection to highlight the line
        textarea.setSelectionRange(lineStart, lineEnd);

        // Calculate scroll position
        const lineHeight = 24; // 1.5 * 16px font size
        const scrollTop = Math.max(0, (lineIndex - 5) * lineHeight); // Show 5 lines above for context

        // Scroll to the line
        textarea.scrollTop = scrollTop;
        textarea.focus();
      }
    },
    [yamlInput]
  );

  const handleGroupClick = (group: Group) => {
    const newSelectedGroup = group.id === selectedGroup ? null : group.id;
    setSelectedGroup(newSelectedGroup);

    if (newSelectedGroup) {
      setHighlightedLine(group.yamlLineIndex);
      scrollToLine(group.yamlLineIndex);
    } else {
      setHighlightedLine(null);
    }
  };

  const handleGroupHover = (groupId: string | null) => {
    setHoveredGroup(groupId);
  };

  const handleConnectionHover = (connectionId: string | null) => {
    setHoveredConnection(connectionId);
  };

  const isConnectionHighlighted = (connection: Connection) => {
    return selectedGroup === connection.from || selectedGroup === connection.to;
  };

  const getSVGPoint = (clientX: number, clientY: number) => {
    if (!svgRef.current || !containerRef.current) return { x: 0, y: 0 };

    const containerRect = containerRef.current.getBoundingClientRect();
    const svgX = (clientX - containerRect.left - transform.x) / transform.scale;
    const svgY = (clientY - containerRect.top - transform.y) / transform.scale;

    return { x: svgX, y: svgY };
  };

  const handleMouseDown = (e: React.MouseEvent, group: Group) => {
    e.preventDefault();
    e.stopPropagation();

    const svgPoint = getSVGPoint(e.clientX, e.clientY);

    setDragState({
      isDragging: true,
      groupId: group.id,
      startX: svgPoint.x - group.x,
      startY: svgPoint.y - group.y,
    });
  };

  const handleSVGMouseDown = (e: React.MouseEvent) => {
    // Only start panning if not clicking on a group
    const target = e.target as Element;
    if (target === svgRef.current || target.classList.contains('diagram-background') || target.tagName === 'rect') {
      e.preventDefault();
      setPanState({
        isPanning: true,
        startX: e.clientX,
        startY: e.clientY,
        startViewX: transform.x,
        startViewY: transform.y,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    e.preventDefault();

    // Cancel any pending animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    // Use requestAnimationFrame for smooth updates
    animationFrameRef.current = requestAnimationFrame(() => {
      if (dragState.isDragging && dragState.groupId) {
        const svgPoint = getSVGPoint(e.clientX, e.clientY);
        const newX = svgPoint.x - dragState.startX;
        const newY = svgPoint.y - dragState.startY;

        setGroups((prev) =>
          prev.map((group) => (group.id === dragState.groupId ? { ...group, x: newX, y: newY } : group))
        );
      } else if (panState.isPanning) {
        const deltaX = e.clientX - panState.startX;
        const deltaY = e.clientY - panState.startY;

        setTransform((prev) => ({
          ...prev,
          x: panState.startViewX + deltaX,
          y: panState.startViewY + deltaY,
        }));
      }
    });
  };

  const handleMouseUp = () => {
    // Cancel any pending animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    setDragState({ isDragging: false, groupId: null, startX: 0, startY: 0 });
    setPanState({ isPanning: false, startX: 0, startY: 0, startViewX: 0, startViewY: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();

    if (!containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;

    // Calculate zoom factor
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(3, transform.scale * zoomFactor));

    // Calculate new position to zoom towards mouse
    const scaleRatio = newScale / transform.scale;
    const newX = mouseX - (mouseX - transform.x) * scaleRatio;
    const newY = mouseY - (mouseY - transform.y) * scaleRatio;

    setTransform({
      scale: newScale,
      x: newX,
      y: newY,
    });
  };

  const handleZoomIn = () => {
    const newScale = Math.min(transform.scale * 1.2, 3);
    if (!containerRef.current) return;

    const centerX = containerRef.current.clientWidth / 2;
    const centerY = containerRef.current.clientHeight / 2;

    const scaleRatio = newScale / transform.scale;
    setTransform(prev => ({
      scale: newScale,
      x: centerX - (centerX - prev.x) * scaleRatio,
      y: centerY - (centerY - prev.y) * scaleRatio,
    }));
  };

  const handleZoomOut = () => {
    const newScale = Math.max(transform.scale * 0.8, 0.1);
    if (!containerRef.current) return;

    const centerX = containerRef.current.clientWidth / 2;
    const centerY = containerRef.current.clientHeight / 2;

    const scaleRatio = newScale / transform.scale;
    setTransform(prev => ({
      scale: newScale,
      x: centerX - (centerX - prev.x) * scaleRatio,
      y: centerY - (centerY - prev.y) * scaleRatio,
    }));
  };

  const handleResetView = () => {
    if (!containerRef.current || groups.length === 0) return;

    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight;
    const contentWidth = contentBounds.maxX - contentBounds.minX;
    const contentHeight = contentBounds.maxY - contentBounds.minY;

    // Calculate scale to fit content with some padding
    const scaleX = (containerWidth * 0.9) / contentWidth;
    const scaleY = (containerHeight * 0.9) / contentHeight;
    const scale = Math.min(scaleX, scaleY, 1);

    // Center the content
    const x = (containerWidth - contentWidth * scale) / 2 - contentBounds.minX * scale;
    const y = (containerHeight - contentHeight * scale) / 2 - contentBounds.minY * scale;

    setTransform({ scale, x, y });
    setSelectedGroup(null);
    setHighlightedLine(null);
  };

  const handleTextareaClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const textarea = e.target as HTMLTextAreaElement;
    const cursorPosition = textarea.selectionStart;
    const textBeforeCursor = yamlInput.substring(0, cursorPosition);
    const lineNumber = textBeforeCursor.split("\n").length - 1;

    // Find the group that corresponds to this line
    const matchingGroup = groups.find((group) => group.yamlLineIndex === lineNumber);
    if (matchingGroup) {
      setSelectedGroup(matchingGroup.id);
      setHighlightedLine(lineNumber);
    } else {
      setSelectedGroup(null);
      setHighlightedLine(null);
    }
  };

  const handleYamlChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setYamlInput(newValue);
    if (onChange) {
      onChange(newValue);
    }
  };

  const onSave = useCallback(() => {
    fireRequest({
      requestType: "POST",
			url: `/api/opamp/${instanceId}/config`,
      body: jsonStringify({
        config: yamlInput,
      }),
      successCb: (resp) => {
        fetchAgentInfo();
      },
      failureCb: (resp) => {
        console.log(resp);
      }
    })
  }, [yamlInput, instanceId]);

  return (
    <div className="w-full h-full flex text-gray-700 border border-stone-200" >
      {/* Left Sidebar */}
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel>
          <div className="w-full h-full flex flex-col">
            {error && (
              <div className="p-4 bg-red-200 shrink-0">
                <p className="text-red-600 text-sm mt-1">{error}</p>
              </div>
            )}
            <div className="relative grow">
              <textarea
                ref={textareaRef}
                value={yamlInput}
                onChange={handleYamlChange}
                onClick={handleTextareaClick}
                readOnly={readOnly}
                className="w-full h-full resize-none p-3 bg-stone-200 text-stone-800 focus:outline-none focus:ring-0"
                placeholder="Paste your YAML content here..."
              />
              {highlightedLine !== null && (
                <div
                  className="absolute left-0 right-0 bg-blue-500 bg-opacity-10 pointer-events-none border-l-2 border-blue-400"
                  style={{
                    top: `${12 + highlightedLine * 24}px`,
                    height: "24px",
                    marginLeft: "12px",
                    marginRight: "12px",
                    borderRadius: "2px",
                  }}
                />
              )}
            </div>
            <div className="shrink-0 p-2 flex items-center justify-between">
              <div className="flex grow">
              <RadioGroup
                  onValueChange={(value: string) => setConfigType(value as "EffectiveConfig" | "CustomInstanceConfig")}
                  defaultValue={configType}
                  className="flex "
                >
                  <div className="flex items-center gap-3">
                    <RadioGroupItem value="CustomInstanceConfig" id="CustomInstanceConfig" />
                    <Label htmlFor="CustomInstanceConfig">Custom Instance Config</Label>
                  </div>
                  <div className="flex items-center gap-3">
                    <RadioGroupItem value="EffectiveConfig" id="EffectiveConfig" />
                    <Label htmlFor="EffectiveConfig">Effective Instance Config</Label>
                  </div>
                </RadioGroup>
              </div>
              {
                configType === "CustomInstanceConfig" ? (

                  <Button variant="default" size={"sm"} className="rounded-none py-1 h-auto bg-primary/80 hover:bg-primary disabled:bg-stone-400 shrink-0" disabled={agent[configType] === yamlInput } onClick={onSave}>Save</Button>
                ) : null
              }
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />

        <ResizablePanel>

          {/* Main Diagram Area */}
          <div className="flex-1 h-full relative bg-gray-900">
            {/* Top Controls */}
            <div className="absolute top-4 right-4 z-10 flex gap-2">
              <button
                onClick={handleZoomIn}
                className="w-10 h-10 bg-gray-800 border border-gray-600 rounded-md hover:bg-gray-700 flex items-center justify-center text-white"
                title="Zoom In"
              >
                +
              </button>
              <button
                onClick={handleZoomOut}
                className="w-10 h-10 bg-gray-800 border border-gray-600 rounded-md hover:bg-gray-700 flex items-center justify-center text-white"
                title="Zoom Out"
              >
                -
              </button>
              <button
                onClick={handleResetView}
                className="w-10 h-10 bg-gray-800 border border-gray-600 rounded-md hover:bg-gray-700 flex items-center justify-center text-white text-xs"
                title="Reset View"
              >
                ⌂
              </button>
            </div>

            <div
              ref={containerRef}
              className="absolute inset-0 overflow-hidden h-full"
              onWheel={handleWheel}
              onMouseDown={handleSVGMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <svg
                ref={svgRef}
                width="100%"
                height="100%"
                className={`${panState.isPanning ? "cursor-grabbing" : "cursor-grab"}`}
                style={{ pointerEvents: 'all' }}
              >
                <defs>
                  {/* <marker id="arrowhead" markerWidth="12" markerHeight="9" refX="11" refY="4.5" orient="auto">
                <polygon points="0 0, 12 4.5, 0 9" fill="#475569" />
              </marker> */}
                </defs>

                {/* Background for panning - make it cover the entire viewport */}
                <rect
                  x="-10000"
                  y="-10000"
                  width="20000"
                  height="20000"
                  fill="transparent"
                  className="diagram-background"
                  style={{ pointerEvents: 'all' }}
                />

                {/* Transformed content group */}
                <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
                  {/* Grid background */}
                  <defs>
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#374151" strokeWidth="1" opacity="0.2" />
                    </pattern>
                  </defs>
                  <rect
                    x={contentBounds.minX}
                    y={contentBounds.minY}
                    width={contentBounds.maxX - contentBounds.minX}
                    height={contentBounds.maxY - contentBounds.minY}
                    fill="url(#grid)"
                  />

                  {/* Render connections */}
                  {connections.map((connection) => (
                    <Connection key={connection.id} connection={connection} groups={groups} transform={transform} onConnectionHover={handleConnectionHover} isHighlighted={isConnectionHighlighted(connection)} isHovered={hoveredConnection === connection.id} />
                  ))}

                  {/* Render groups */}
                  {groups.map((group) => (
                    <GroupNode
                      key={group.id}
                      group={group}
                      isDragging={dragState.isDragging && dragState.groupId === group.id}
                      isSelected={selectedGroup === group.id}
                      onMouseDown={handleMouseDown}
                      onGroupClick={handleGroupClick}
                      transform={transform}
                      isHovered={hoveredGroup === group.id}
                      onGroupHover={handleGroupHover}
                    />
                  ))}
                </g>
              </svg>
            </div>

            {groups.length === 0 && !error && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-gray-400 text-center">
                  <div className="text-6xl mb-4">🔗</div>
                  <h3 className="text-xl font-medium mb-2">Ready to visualize</h3>
                  <p>Enter YAML content to see the grouped diagram</p>
                </div>
              </div>
            )}

            {/* Bottom Status */}
            <div className="absolute bottom-4 left-4 text-sm text-gray-400">
              Groups: {groups.length} • Connections: {connections.length} • Zoom: {Math.round(transform.scale * 100)}%
              {selectedGroup && <span className="ml-4 text-blue-400">• Selected: {selectedGroup}</span>}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

    </div>
  );
};

export default YAMLDiagramVisualizer