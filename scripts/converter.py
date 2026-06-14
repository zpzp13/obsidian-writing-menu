# -*- coding: utf-8 -*-
import os
import re
import sys
import shutil
import tempfile
import time
import traceback
import tkinter as tk
from tkinter import filedialog

# Set UTF-8 encoding globally for Windows console
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# Clear gen_py cache to prevent COM cache corruption issues
def clear_gen_py_cache():
    gen_py_path = os.path.join(tempfile.gettempdir(), 'gen_py')
    if os.path.exists(gen_py_path):
        try:
            shutil.rmtree(gen_py_path)
        except:
            pass

clear_gen_py_cache()
import win32com.client

def pick_dialog(mode='folder'):
    sys.stdout.reconfigure(encoding='utf-8')
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)

    if mode == 'file':
        selected = filedialog.askopenfilename(filetypes=[("HWP Files", "*.hwp;*.hwpx"), ("All Files", "*.*")])
    else:
        selected = filedialog.askdirectory()

    if selected:
        print(selected.replace('/', '\\'))
    else:
        print("")
    root.destroy()

def clean_markdown(content):
    pattern = r'^---\s*\n.*?\n---\s*\n?'
    cleaned = re.sub(pattern, '', content, flags=re.DOTALL | re.MULTILINE)
    return cleaned.strip()

def remove_headings(content):
    lines = content.split('\n')
    filtered = [line for line in lines if not re.match(r'^#{1,6}\s', line.strip())]
    return '\n'.join(filtered).strip()

def convert_to_hwp(input_path, output_path, use_space_indent=False, hwp_instance=None, template_path=None, exclude_headings=False):
    print(f"Input: {input_path}")
    print(f"Output: {output_path}")
    if template_path:
        print(f"Template: {template_path}")

    is_batch_mode = (hwp_instance is not None)

    if not os.path.exists(input_path):
        print("Error: Input file does not exist.")
        return False

    filename = os.path.basename(input_path)

    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        try:
            os.makedirs(output_dir, exist_ok=True)
        except:
            pass

    try:
        with open(input_path, "r", encoding="utf-8") as f:
            content = f.read()

        body_text = clean_markdown(content)

        if exclude_headings:
            body_text = remove_headings(body_text)

        if use_space_indent:
            lines = body_text.splitlines()
            processed_lines = []
            for line in lines:
                if line.strip():
                    processed_lines.append(" " + line)
                else:
                    processed_lines.append(line)
            body_text = "\n".join(processed_lines)

        body_text = body_text.replace("\n", "\r\n")

        if is_batch_mode:
            hwp = hwp_instance
        else:
            hwp = win32com.client.Dispatch("HWPFrame.HwpObject")
            hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
            hwp.XHwpWindows.Item(0).Visible = True

        if template_path and os.path.exists(template_path):
            hwp.Open(template_path, "HWP", "forceopen:true")
        else:
            hwp.Clear(1)

        hwp.HAction.Run("MoveDocEnd")
        hwp.HAction.Run("SelectAll")
        hwp.HAction.Run("Delete")

        hwp.HAction.GetDefault("InsertText", hwp.HParameterSet.HInsertText.HSet)
        hwp.HParameterSet.HInsertText.Text = body_text
        hwp.HAction.Execute("InsertText", hwp.HParameterSet.HInsertText.HSet)

        hwp.SaveAs(output_path, "HWP", "")

        if not is_batch_mode:
            time.sleep(0.5)
            hwp.Quit()

        if not os.path.exists(output_path):
            print(f"Error: File not created at {output_path}")
            return False

        print(f"Converted: {filename}")
        return True

    except Exception as e:
        print(f"Error converting {filename}: {e}")
        if not is_batch_mode:
             try: hwp.Quit()
             except: pass
        return False

def convert_batch(folder_path, output_base_dir, use_space_indent=False, template_path=None, exclude_headings=False):
    print("Starting Batch Conversion...")
    sys.stdout.reconfigure(encoding='utf-8')

    if not os.path.isdir(folder_path):
        print("Error: Invalid folder path.")
        sys.exit(1)

    try:
        hwp = win32com.client.Dispatch("HWPFrame.HwpObject")
        hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        hwp.XHwpWindows.Item(0).Visible = True
    except Exception as e:
        print(f"HWP Init Error: {e}")
        sys.exit(1)

    count = 0
    success_count = 0

    for root, dirs, files in os.walk(folder_path):
        for file in files:
            if file.lower().endswith(".md"):
                input_file = os.path.join(root, file)
                relative_path = os.path.relpath(input_file, folder_path)
                relative_dir = os.path.dirname(relative_path)
                base_name = os.path.splitext(file)[0]
                output_file_name = base_name + ".hwp"
                output_dir = os.path.join(output_base_dir, relative_dir)
                output_file = os.path.join(output_dir, output_file_name)

                if convert_to_hwp(input_file, output_file, use_space_indent, hwp, template_path, exclude_headings):
                    success_count += 1
                count += 1

    time.sleep(0.5)
    hwp.Quit()
    print(f"Batch Complete: {success_count}/{count}")

def convert_list(list_file_path, output_dir, use_space_indent=False, template_path=None, exclude_headings=False):
    print("Starting List Batch Conversion...")
    sys.stdout.reconfigure(encoding='utf-8')

    if not os.path.exists(list_file_path):
        print("Error: List file not found.")
        sys.exit(1)

    with open(list_file_path, 'r', encoding='utf-8') as f:
        file_paths = [line.strip() for line in f if line.strip()]

    try:
        hwp = win32com.client.Dispatch("HWPFrame.HwpObject")
        hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        hwp.XHwpWindows.Item(0).Visible = True
    except Exception as e:
        print(f"HWP Init Error: {e}")
        sys.exit(1)

    count = 0
    success_count = 0

    for input_file in file_paths:
        if os.path.exists(input_file):
            filename = os.path.basename(input_file)
            base_name = os.path.splitext(filename)[0]
            output_file_name = base_name + ".hwp"
            output_file = os.path.join(output_dir, output_file_name)

            if convert_to_hwp(input_file, output_file, use_space_indent, hwp, template_path, exclude_headings):
                success_count += 1
            count += 1
        else:
            print(f"Skipping missing file: {input_file}")

    time.sleep(0.5)
    hwp.Quit()
    print(f"Batch Complete: {success_count}/{count}")

def merge_folder(folder_path, output_path, use_space_indent=False, template_path=None, exclude_headings=False):
    print("Starting Merge Folder...")
    sys.stdout.reconfigure(encoding='utf-8')

    if not os.path.isdir(folder_path):
        print("Error: Invalid folder path.")
        sys.exit(1)

    all_contents = []

    for root, dirs, files in os.walk(folder_path):
        for file in sorted(files):
            if file.lower().endswith(".md"):
                input_file = os.path.join(root, file)
                try:
                    with open(input_file, "r", encoding="utf-8") as f:
                        content = f.read()
                    body_text = clean_markdown(content)

                    if exclude_headings:
                        body_text = remove_headings(body_text)

                    if use_space_indent:
                        lines = body_text.splitlines()
                        processed_lines = []
                        for line in lines:
                            if line.strip():
                                processed_lines.append(" " + line)
                            else:
                                processed_lines.append(line)
                        body_text = "\n".join(processed_lines)

                    all_contents.append(body_text)
                    print(f"Added: {file}")
                except Exception as e:
                    print(f"Error reading {file}: {e}")

    if not all_contents:
        print("No files to merge.")
        sys.exit(1)

    merged_text = "\n\n".join(all_contents)
    merged_text = merged_text.replace("\n", "\r\n")

    try:
        hwp = win32com.client.Dispatch("HWPFrame.HwpObject")
        hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        hwp.XHwpWindows.Item(0).Visible = True

        if template_path and os.path.exists(template_path):
            hwp.Open(template_path, "HWP", "forceopen:true")
        else:
            hwp.Clear(1)

        hwp.HAction.Run("MoveDocEnd")
        hwp.HAction.Run("SelectAll")
        hwp.HAction.Run("Delete")

        hwp.HAction.GetDefault("InsertText", hwp.HParameterSet.HInsertText.HSet)
        hwp.HParameterSet.HInsertText.Text = merged_text
        hwp.HAction.Execute("InsertText", hwp.HParameterSet.HInsertText.HSet)

        output_dir = os.path.dirname(output_path)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)

        hwp.SaveAs(output_path, "HWP", "")
        time.sleep(0.5)
        hwp.Quit()

        if os.path.exists(output_path):
            print(f"Merged: {os.path.basename(output_path)}")
        else:
            print("Error: Merged file not created.")
    except Exception as e:
        print(f"Error: {e}")
        try: hwp.Quit()
        except: pass

def merge_list(list_file_path, output_path, use_space_indent=False, template_path=None, exclude_headings=False):
    print("Starting Merge List...")
    sys.stdout.reconfigure(encoding='utf-8')

    if not os.path.exists(list_file_path):
        print("Error: List file not found.")
        sys.exit(1)

    with open(list_file_path, 'r', encoding='utf-8') as f:
        file_paths = [line.strip() for line in f if line.strip()]

    all_contents = []

    for input_file in file_paths:
        if os.path.exists(input_file):
            try:
                with open(input_file, "r", encoding="utf-8") as f:
                    content = f.read()
                body_text = clean_markdown(content)

                if exclude_headings:
                    body_text = remove_headings(body_text)

                if use_space_indent:
                    lines = body_text.splitlines()
                    processed_lines = []
                    for line in lines:
                        if line.strip():
                            processed_lines.append(" " + line)
                        else:
                            processed_lines.append(line)
                    body_text = "\n".join(processed_lines)

                all_contents.append(body_text)
                print(f"Added: {os.path.basename(input_file)}")
            except Exception as e:
                print(f"Error reading {input_file}: {e}")
        else:
            print(f"Skipping missing: {input_file}")

    if not all_contents:
        print("No files to merge.")
        sys.exit(1)

    merged_text = "\n\n".join(all_contents)
    merged_text = merged_text.replace("\n", "\r\n")

    try:
        hwp = win32com.client.Dispatch("HWPFrame.HwpObject")
        hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        hwp.XHwpWindows.Item(0).Visible = True

        if template_path and os.path.exists(template_path):
            hwp.Open(template_path, "HWP", "forceopen:true")
        else:
            hwp.Clear(1)

        hwp.HAction.Run("MoveDocEnd")
        hwp.HAction.Run("SelectAll")
        hwp.HAction.Run("Delete")

        hwp.HAction.GetDefault("InsertText", hwp.HParameterSet.HInsertText.HSet)
        hwp.HParameterSet.HInsertText.Text = merged_text
        hwp.HAction.Execute("InsertText", hwp.HParameterSet.HInsertText.HSet)

        output_dir = os.path.dirname(output_path)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)

        hwp.SaveAs(output_path, "HWP", "")
        time.sleep(0.5)
        hwp.Quit()

        if os.path.exists(output_path):
            print(f"Merged: {os.path.basename(output_path)}")
        else:
            print("Error: Merged file not created.")
    except Exception as e:
        print(f"Error: {e}")
        try: hwp.Quit()
        except: pass

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "--pick-folder":
            pick_dialog(mode='folder')
            sys.exit(0)
        elif sys.argv[1] == "--pick-file":
            pick_dialog(mode='file')
            sys.exit(0)

    filtered_args = []
    _use_space = False
    _exclude_headings = False
    _template = None
    i = 0
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg == "--space-indent":
            _use_space = True
            i += 1
        elif arg == "--exclude-headings":
            _exclude_headings = True
            i += 1
        elif arg == "--template":
            if i + 1 < len(sys.argv):
                _template = sys.argv[i+1]
                i += 2
            else:
                i += 1
        else:
            filtered_args.append(arg)
            i += 1

    if len(filtered_args) >= 4 and filtered_args[1] == "--batch-folder":
        convert_batch(filtered_args[2], filtered_args[3], _use_space, _template, _exclude_headings)
    elif len(filtered_args) >= 4 and filtered_args[1] == "--batch-list":
        convert_list(filtered_args[2], filtered_args[3], _use_space, _template, _exclude_headings)
    elif len(filtered_args) >= 4 and filtered_args[1] == "--merge-folder":
        merge_folder(filtered_args[2], filtered_args[3], _use_space, _template, _exclude_headings)
    elif len(filtered_args) >= 4 and filtered_args[1] == "--merge-list":
        merge_list(filtered_args[2], filtered_args[3], _use_space, _template, _exclude_headings)
    elif len(filtered_args) >= 3:
        if not convert_to_hwp(filtered_args[1], filtered_args[2], _use_space, None, _template, _exclude_headings):
            sys.exit(1)
