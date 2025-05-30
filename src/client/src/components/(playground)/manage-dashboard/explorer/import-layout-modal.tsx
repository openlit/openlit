import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

export default function ImportLayoutModal({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (data: any) => Promise<{ err: string; data: string }>;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsLoading(true);
      setError(null);

      // Validate file type
      if (!file.name.endsWith('.json')) {
        throw new Error("Please upload a JSON file");
      }

      const text = await file.text();
      const data = JSON.parse(text);

      await onImport(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import layout");
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    try {
      setIsLoading(true);
      setError(null);

      // Validate file type
      if (!file.name.endsWith('.json')) {
        throw new Error("Please upload a JSON file");
      }

      const text = await file.text();
      const data = JSON.parse(text);

      await onImport(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import layout");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Import Board Layout</DialogTitle>
        </DialogHeader>
        <div
          className={`
            p-8 border-2 border-dashed rounded-lg text-center cursor-pointer
            transition-colors hover:border-primary hover:bg-primary/5
            ${isLoading ? "opacity-50 cursor-not-allowed" : ""}
          `}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="hidden"
          />
          <Upload className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
          <div className="space-y-2">
            <p>Drag & drop a layout file here, or click to select</p>
            <p className="text-sm text-muted-foreground">
              Only .json files are supported
            </p>
          </div>
        </div>
        {error && (
          <p className="text-sm text-destructive mt-2">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
} 