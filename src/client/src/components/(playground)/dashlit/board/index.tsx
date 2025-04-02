import { useState, useEffect, useCallback } from "react";
import { File, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import { Board } from "@/types/dashlit";

export default function BoardList() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { fireRequest } = useFetchWrapper();

  const fetchBoards = useCallback(() => {
    setIsLoading(true);
    fireRequest({
      url: "/api/dashlit/board",
      requestType: "GET",
      successCb: (response) => {
        if (response?.data) {
          setBoards(response.data);
        }
        setIsLoading(false);
      },
      failureCb: (error) => {
        toast.error("Failed to load boards");
        console.error("Error loading boards:", error);
        setIsLoading(false);
      }
    });
  }, [fireRequest]);

  useEffect(() => {
    fetchBoards();
  }, [fetchBoards]);

  const navigateToBoard = useCallback((boardId: string) => {
    window.location.href = `/custom-dashboard/board/${boardId}`;
  }, []);

  return (
    <div className="border rounded-md p-4">
      <h3 className="font-medium mb-4">Available Boards</h3>
      
      {isLoading ? (
        <div className="flex justify-center items-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : boards.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p>No boards available</p>
          <p className="text-sm mt-2">Create a board in the Explorer to get started</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {boards.map((board) => (
            <li key={board.id} className="group">
              <Button
                variant="ghost"
                className="w-full justify-start px-2 py-1 h-auto"
                onClick={() => navigateToBoard(board.id)}
              >
                <div className="flex items-center gap-2">
                  <File className="h-4 w-4 text-blue-500" />
                  <span className="flex-1 text-left">{board.title}</span>
                  <ExternalLink className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
	);
}
