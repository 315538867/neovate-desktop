/**
 * Pure presentational components for files-view (no hooks, no side effects).
 *
 * Extracted from files-view.tsx to keep the orchestrating container focused on
 * state management. These components own only the JSX shapes for each render
 * branch (empty / loading / normal).
 */
import { Folder02Icon, File02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Virtuoso } from "react-virtuoso";

import type { MenuGroup } from "./menu-types";

import { getEmpty2Url } from "../../assets/images";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import {
  ContextMenu,
  ContextMenuPopup,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import { ContextMenuGroups } from "./context-menu-groups";
import { FileNodeItem, FileTreeContext } from "./hooks/useFileData";
import { useFilesTranslation } from "./i18n";
import { TreeNode } from "./tree-node";

export function FilesEmptyState({
  resolvedTheme,
  t,
}: {
  resolvedTheme: string | undefined;
  t: ReturnType<typeof useFilesTranslation>["t"];
}) {
  return (
    <div className="flex h-full flex-col p-3">
      <h2 className="text-sm font-semibold text-muted-foreground">{t("title")}</h2>
      <div className="flex flex-1 items-center justify-center flex-col gap-2 ">
        <img
          src={getEmpty2Url(resolvedTheme as "dark" | "light" | undefined)}
          alt="Empty"
          className="shrink-0"
          style={{ width: 67 + "px", marginLeft: "10px" }}
          aria-hidden
        />
        <p className="text-xs text-muted-foreground">{t("noProject")}</p>
      </div>
    </div>
  );
}

export function FilesLoadingState({ t }: { t: ReturnType<typeof useFilesTranslation>["t"] }) {
  return (
    <div className="flex h-full flex-col p-3">
      <h2 className="text-sm font-semibold text-muted-foreground">{t("title")}</h2>
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground">
          {t("common.loading", { ns: "translation" })}
        </p>
      </div>
    </div>
  );
}

export interface FilesNormalViewProps {
  // File tree context
  nodes: FileNodeItem[];
  expandedKeys: Set<string>;
  selectedKeys: Set<string>;
  renameStart: (key: string) => void;
  renameEnd: () => void;
  renamingKey: string;
  pendingCreation: { parentPath: string; type: "file" | "folder" } | null;
  createStart: (type: "file" | "folder", parentPath: string) => void;
  createEnd: () => void;
  cancelSelect: () => void;
  expand: (key: string) => void;
  toggleExpand: (key: string) => void;
  flatVisible: { node: FileNodeItem; level: number }[];

  // Root creation
  rootCreating: { type: "file" | "folder" } | null;
  rootCreatingName: string;
  setRootCreatingName: (name: string) => void;
  onRootCreateFinish: () => void;
  onRootCreateCancel: () => void;

  // Root menu
  rootMenuGroups: MenuGroup[];

  // Tree item callbacks
  onSelect: (item: FileNodeItem) => void;
  onDelete: (item: FileNodeItem) => void;
  onRename: (oldPath: string, newPath: string) => Promise<boolean>;
  onCreate: (newNode: { parentPath: string; name: string; isFolder: boolean }) => void;
  onAdd: (item: FileNodeItem) => void;
  onCopy: (item: FileNodeItem) => void;
  onCut: (item: FileNodeItem) => void;
  onPaste: (targetPath: string) => void;
  canPaste: (targetPath: string) => boolean;
  onReveal: (item: FileNodeItem) => void;

  // Clipboard
  cutSourcePath: string | null;

  // Delete dialog
  deleteConfirmOpen: boolean;
  onDeleteConfirmOpenChange: (open: boolean) => void;
  itemToDelete: FileNodeItem | null;
  onConfirmDelete: () => void;

  // i18n
  t: ReturnType<typeof useFilesTranslation>["t"];
}

export function FilesNormalState({
  nodes,
  expandedKeys,
  selectedKeys,
  renameStart,
  renameEnd,
  renamingKey,
  pendingCreation,
  createStart,
  createEnd,
  cancelSelect,
  expand,
  toggleExpand,
  flatVisible,
  rootCreating,
  rootCreatingName,
  setRootCreatingName,
  onRootCreateFinish,
  onRootCreateCancel,
  rootMenuGroups,
  onSelect,
  onDelete,
  onRename,
  onCreate,
  onAdd,
  onCopy,
  onCut,
  onPaste,
  canPaste,
  onReveal,
  cutSourcePath,
  deleteConfirmOpen,
  onDeleteConfirmOpenChange,
  itemToDelete,
  onConfirmDelete,
  t,
}: FilesNormalViewProps) {
  return (
    <FileTreeContext.Provider
      value={{
        nodes,
        expandedKeys,
        selectedKeys,
        renameStart,
        renameEnd,
        renamingKey,
        pendingCreation,
        createStart,
        createEnd,
      }}
    >
      <div className="flex h-full flex-col p-3 overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("title")}</h2>
        </div>

        <ContextMenu>
          <ContextMenuTrigger
            render={
              <div
                className="flex-1 flex flex-col min-h-0 -mr-2.5"
                onClick={(e) => {
                  // Only clear selection when clicking the empty area (not tree nodes)
                  if (e.target === e.currentTarget) {
                    cancelSelect();
                  }
                }}
              >
                {rootCreating && (
                  <div className="flex items-center gap-1 px-2 py-1 hover:bg-accent hover:text-accent-foreground rounded-sm">
                    <div className="w-4 h-4 flex items-center justify-center">
                      <HugeiconsIcon
                        icon={rootCreating.type === "folder" ? Folder02Icon : File02Icon}
                        size={18}
                        strokeWidth={1.5}
                      />
                    </div>
                    <span className="flex-1 text-sm ml-2 cursor-pointer">
                      <input
                        type="text"
                        placeholder={
                          rootCreating.type === "file"
                            ? t("newFilePlaceholder")
                            : t("newFolderPlaceholder")
                        }
                        value={rootCreatingName}
                        onChange={(e) => setRootCreatingName(e.target.value)}
                        onBlur={onRootCreateFinish}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.stopPropagation();
                            onRootCreateFinish();
                          } else if (e.key === "Escape") {
                            e.stopPropagation();
                            onRootCreateCancel();
                          }
                        }}
                        className="w-full bg-background border border-border rounded px-2 py-1"
                        autoFocus
                      />
                    </span>
                  </div>
                )}
                {nodes.length === 0 ? (
                  <div className="flex items-center justify-center h-32">
                    <p className="text-xs text-muted-foreground">{t("emptyDirectory")}</p>
                  </div>
                ) : (
                  <Virtuoso
                    data={flatVisible}
                    increaseViewportBy={400}
                    computeItemKey={(_, { node }) => node.fullPath}
                    itemContent={(_, { node, level }) => (
                      <TreeNode
                        item={node}
                        level={level}
                        renderChildren={false}
                        onExpand={expand}
                        onToggleExpand={toggleExpand}
                        onSelect={onSelect}
                        onDelete={onDelete}
                        onRename={onRename}
                        onCreate={onCreate}
                        onAdd={onAdd}
                        onCopy={onCopy}
                        onCut={onCut}
                        onPaste={onPaste}
                        canPaste={canPaste}
                        onReveal={onReveal}
                        cutSourcePath={cutSourcePath}
                      />
                    )}
                    style={{ flex: 1 }}
                  />
                )}
              </div>
            }
          />
          <ContextMenuPopup>
            <ContextMenuGroups groups={rootMenuGroups} />
          </ContextMenuPopup>
        </ContextMenu>

        <AlertDialog open={deleteConfirmOpen} onOpenChange={onDeleteConfirmOpenChange}>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("delete.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("delete.description", { name: itemToDelete?.fileName })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>
                {t("common.cancel", { ns: "translation" })}
              </AlertDialogClose>
              <Button variant="destructive" onClick={onConfirmDelete}>
                {t("common.delete", { ns: "translation" })}
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      </div>
    </FileTreeContext.Provider>
  );
}
