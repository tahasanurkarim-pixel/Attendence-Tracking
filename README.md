# Rollcall — Attendance Tracking

A modern web interface and authenticated SQLite backend built around the original C++ attendance rules.

- Frontend: `web/` — dashboard, attendance register, student profiles, timetable and reports.
- Backend: `server/` — persistent storage and authenticated API.
- Deployment: GitHub Pages workflow included.
- [Web setup, data migration and backend guide](WEB_GUIDE.md)
- Tests: `npm test` (Node.js 24+).

The original C++ project is preserved below.

---

Attendance Tracking System

A C++ based console application designed to manage student attendance records efficiently. The system allows attendance to be recorded for scheduled classes, stored in a file, and viewed as individual or complete attendance reports.

Project Information

Project Name: Attendance Tracking System

Developer: Tahasanur Karim

Email: tahasanurkarim@gmail.com

Language: C++

Application Type: Console Application

Features

1. Take Attendance

Select a class day and class period from the weekly routine.

Enter a specific date or use the current date automatically.

Mark attendance in three different ways:

Mark all students Present

Mark all students Absent

Mark students individually

Individual attendance accepts P for Present and A for Absent.

Prevents duplicate attendance records for the same student, course, date, and time slot.

2. View Student Status

Search for a student using their Student ID.

View attendance information for all students using ALL.

Displays:

Student ID

Student name

Attended classes

Total classes

Attendance percentage

Attendance status

3. Attendance Status

The system categorizes attendance percentage as:

Percentage

Status

85% or above

Excellent

70% – 84.9%

Good

60% – 69.9%

Warning

Below 60%

At Risk

4. Weekly Class Routine

The application includes a weekly routine for Saturday through Wednesday and displays the scheduled course, start time, and end time.

5. File Handling

Attendance records are saved in:

attendance_data.txt

The program automatically loads previously saved attendance data when it starts and saves new attendance records after attendance is taken.

Technologies & Concepts Used

C++

Arrays

Structures (struct)

Functions

String handling

File Input/Output (ifstream, ofstream)

Basic searching

Date and time handling

Conditional statements

Loops

Input validation

Console-based menu system

Data Structures

The project uses several structures to organize information:

Student

Stores:

Serial number

Student ID

Student name

Course

Stores:

Course code

Course title

Total classes

ClassPeriod

Stores:

Day

Start time

End time

Course code

AttendanceRecord

Stores:

Student ID

Course code

Date

Time slot

Present/Absent status

Program Limits

The current implementation uses fixed-size arrays with the following limits:

Data

Maximum

Students

50

Courses

10

Class periods

30

Attendance records

2000

Main Menu

ATTENDANCE TRACKING SYSTEM
University Management System

[1] Take Attendance
[2] View Student Status
[3] View Weekly Routine
[4] Exit

How to Run

Using g++

Compile the program with:

g++ attendance_system.cpp -o attendance_system

Run it with:

./attendance_system

Windows

If you are using Windows with MinGW:

g++ attendance_system.cpp -o attendance_system.exe
attendance_system.exe

File Format

Attendance data is stored using the following format:

StudentID|CourseCode|Date|TimeSlot|Present

Example:

C253022|CSE-1121|14-09-2026|01:50 PM|1

Where:

1 = Present

0 = Absent

Project Structure

Attendance-Tracking-System/
│
├── attendance_system.cpp
├── attendance_data.txt
└── README.md

attendance_data.txt is created/updated by the program when attendance data is saved.

How the System Works

Start Program
      ↓
Initialize Students, Courses & Routine
      ↓
Load Existing Attendance Data
      ↓
Display Main Menu
      ↓
 ┌────┼───────────────┐
 ↓    ↓               ↓
Take  View Status     View Routine
Attendance
 ↓
Save Attendance
 ↓
Return to Main Menu
      ↓
     Exit

Author

Tahasanur Karim

Computer Science & Engineering Student

Email: tahasanurkarim@gmail.com

