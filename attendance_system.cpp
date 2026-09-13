

#include <ctime>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <string>

using namespace std;

// const. - Maximum sizes for our arrays

const int MAX_STUDENTS = 50;
const int MAX_COURSES = 10;
const int MAX_PERIODS = 30;
const int MAX_RECORDS = 2000;

// DATA STRUCTURES (structs)

//  student information
struct Student
{
  int sl;
  string id;
  string name;
};

// course information
struct Course
{
  string code;
  string title;
  int totalClasses;
};

struct ClassPeriod
{
  string day;
  string startTime; // Start "10:40 AM"
  string endTime;   // end "11:30 AM"
  string courseCode;
};

struct AttendanceRecord
{
  string studentId;
  string courseCode;
  string date;
  string timeSlot;
  bool present;
};

// GLOBAL ARRAYS - Store all our data
//------------------------------------

Student students[MAX_STUDENTS];
int studentCount = 0;

Course courses[MAX_COURSES];
int courseCount = 0;

ClassPeriod routine[MAX_PERIODS];
int periodCount = 0;

AttendanceRecord records[MAX_RECORDS];
int recordCount = 0;

// File name for saving attendance data
const string DATA_FILE = "attendance_data.txt";

// FUNCTIONS

void clearScreen()
{
#ifdef _WIN32
  system("cls");
#else
  system("clear");
#endif
}

// Function to pause and wait for user input
void pauseScreen()
{
  cout << "\nPress Enter to continue...";
  cin.ignore();
  cin.get();
}

// Function to get current date as a string (DD-MM-YYYY)
string getCurrentDate()
{
  time_t now = time(0);
  tm *ltm = localtime(&now);

  //  date string nisi manualy
  string day = to_string(ltm->tm_mday);
  string month = to_string(1 + ltm->tm_mon);
  string year = to_string(1900 + ltm->tm_year);

  // leading zero add korsi dorkar porle
  if (day.length() == 1)
    day = "0" + day;
  if (month.length() == 1)
    month = "0" + month;

  return day + "-" + month + "-" + year;
}

// separator line print
void printLine() { cout << "----------------------------------------" << endl; }

//  double separator line print
void printDoubleLine()
{
  cout << "========================================" << endl;
}

// INITIALIZATION FUNCTIONS
//----------------------------

void initializeStudents()
{

  students[0] = {1, "C251027", "Mohammad Sifat Ullah"};
  students[1] = {2, "C253002", "Sultan Mahmud"};
  students[2] = {3, "C253003", "Md. Zunaed Rahman Afif"};
  students[3] = {4, "C253005", "Mohammad Fahim Hasan"};
  students[4] = {5, "C253010", "Sakif Anam"};
  students[5] = {6, "C253011", "Md. Imam Samir Ali"};
  students[6] = {7, "C253012", "Shoman Nath Ayon"};
  students[7] = {8, "C253019", "Iftekhar Uddin Bhuiyan"};
  students[8] = {9, "C253020", "Md. Muntasir Mahmud"};
  students[9] = {10, "C253021", "Daniel Bin Ashraf"};
  students[10] = {11, "C253022", "Mohammad Shadman Abedin"};
  students[11] = {12, "C253026", "Ahmad Nayeem Uddin Khan"};
  students[12] = {13, "C253031", "Saroar Alam"};
  students[13] = {14, "C253037", "Hassan Zahin"};
  students[14] = {15, "C253041", "Hossain Mahmud"};
  students[15] = {16, "C253042", "Rafsan-Ul-Islam"};
  students[16] = {17, "C253046", "Shahriar Ibne Alam Mahee"};
  students[17] = {18, "C253048", "Saniyat Hossain"};
  students[18] = {19, "C253053", "Abdullah-Al-Sifat"};
  students[19] = {20, "C253058", "Miskat Bin Kamal"};
  students[20] = {21, "C253062", "Md. Salsabil"};
  students[21] = {22, "C253064", "Mohammad Akib Akbar"};
  students[22] = {23, "C253068", "Tahasanur Karim"};
  students[23] = {24, "C253071", "Ashraful Kader Jitu"};
  students[24] = {25, "C253072", "Mohammad Hasnat Monowar Kaify"};
  students[25] = {26, "C253075", "Sakir Adnan Nabil"};
  students[26] = {27, "C253076", "Ahmad Bin Tarique"};
  students[27] = {28, "C253077", "Md. Foisal Hossen Chowdhury"};
  students[28] = {29, "C253078", "Fakharuddin Bin Walid"};
  students[29] = {30, "C253085", "Md. Maruf Siddique"};
  students[30] = {31, "C253087", "Ayatul Hakim"};
  students[31] = {32, "C253088", "S.M.Mahidul Alam"};
  students[32] = {33, "C253089", "Mohammad Naza Mobashirul Islam"};
  students[33] = {34, "C253091", "Iftekhar Ahmed Ifaz"};
  students[34] = {35, "C253094", "Towhidul Islam"};
  students[35] = {36, "C253099", "Azizul Hoque Samin"};
  students[36] = {37, "C253104", "Mohammad Rashed Anwar Ovi"};
  students[37] = {38, "C253109", "Hafiz Al Azad Al Naheean"};
  students[38] = {39, "C253111", "Md. Usha Araf"};
  students[39] = {40, "C253122", "Anaf Chowdhury"};
  students[40] = {41, "C253135", "Md Ifthikhar Uddin Chowdhury Rahat"};
  students[41] = {42, "C253118", "Akil Alam Ansary"};
  students[42] = {43, "C251106", "Md. Azizur Rahman"};
  students[43] = {44, "C251114", "Mustofa Mahamud Rafi"};
  students[44] = {45, "C253169", "Mohammad Ariful Islam"};

  studentCount = 45;
}

void initializeCourses()
{
  courses[0] = {"EEE-1121", "Electrical Engineering Fundamentals", 48};
  courses[1] = {"EEE-1122", "Electrical Engineering Lab", 48};
  courses[2] = {"CSE-1121", "Computer Programming", 48};
  courses[3] = {"CSE-1122", "Computer Programming Lab", 48};
  courses[4] = {"MATH-1107", "Mathematics", 48};
  courses[5] = {"PHY-1101", "Physics", 48};
  courses[6] = {"GEEL-1106", "Advance English", 48};
  courses[7] = {"GEEM-1101", "Ethics and Morality", 32};

  courseCount = 8;
}

void initializeRoutine()
{
  // Saturday classes
  routine[0] = {"Saturday", "11:30 AM", "12:20 PM", "EEE-1121"};
  routine[1] = {"Saturday", "12:20 PM", "01:10 PM", "GEEL-1106"};
  routine[2] = {"Saturday", "01:50 PM", "02:40 PM", "CSE-1121"};

  // Sunday classes
  routine[3] = {"Sunday", "10:40 AM", "11:30 AM", "PHY-1101"};
  routine[4] = {"Sunday", "11:30 AM", "12:20 PM", "GEEL-1106"};
  routine[5] = {"Sunday", "12:20 PM", "01:10 PM", "GEEL-1106"};

  // Monday classes
  routine[6] = {"Monday", "10:40 AM", "11:30 AM", "CSE-1122"};
  routine[7] = {"Monday", "11:30 AM", "12:20 PM", "CSE-1122"};
  routine[8] = {"Monday", "12:20 PM", "01:10 PM", "CSE-1122"};
  routine[9] = {"Monday", "01:50 PM", "02:40 PM", "PHY-1101"};
  routine[10] = {"Monday", "02:40 PM", "03:30 PM", "PHY-1101"};
  routine[11] = {"Monday", "03:30 PM", "04:20 PM", "GEEM-1101"};

  // Tuesday classes
  routine[12] = {"Tuesday", "10:40 AM", "11:30 AM", "MATH-1107"};
  routine[13] = {"Tuesday", "11:30 AM", "12:20 PM", "EEE-1121"};
  routine[14] = {"Tuesday", "12:20 PM", "01:10 PM", "EEE-1121"};
  routine[15] = {"Tuesday", "01:50 PM", "02:40 PM", "EEE-1122"};
  routine[16] = {"Tuesday", "02:40 PM", "03:30 PM", "EEE-1122"};
  routine[17] = {"Tuesday", "03:30 PM", "04:20 PM", "EEE-1122"};

  // Wednesday classes
  routine[18] = {"Wednesday", "10:40 AM", "11:30 AM", "CSE-1121"};
  routine[19] = {"Wednesday", "11:30 AM", "12:20 PM", "CSE-1121"};
  routine[20] = {"Wednesday", "12:20 PM", "01:10 PM", "GEEM-1101"};
  routine[21] = {"Wednesday", "01:50 PM", "02:40 PM", "MATH-1107"};
  routine[22] = {"Wednesday", "02:40 PM", "03:30 PM", "MATH-1107"};

  periodCount = 23;
}

// -----FILE In/Out FUNCTIONS----

// Save all attendance records to file
void saveToFile()
{
  ofstream file(DATA_FILE);

  if (!file.is_open())
  {
    cout << "Error: Could not open file for saving!" << endl;
    return;
  }

  // Write header comment jeta file e show kore
  file << "# Attendance Data File" << endl;
  file << "# Format: StudentID|CourseCode|Date|TimeSlot|Present" << endl;

  // Write each record
  for (int i = 0; i < recordCount; i++)
  {
    file << records[i].studentId << "|" << records[i].courseCode << "|"
         << records[i].date << "|" << records[i].timeSlot << "|"
         << (records[i].present ? "1" : "0") << endl;
  }

  file.close();
  cout << "Data saved successfully!" << endl;
}

// attendence read kora file thake
void loadFromFile()
{
  ifstream file(DATA_FILE);

  if (!file.is_open())
  {
    // fresh start file na thakle
    return;
  }

  string line;
  recordCount = 0;

  while (getline(file, line))
  {
    // Skip empty lines and comments
    if (line.empty() || line[0] == '#')
    {
      continue;
    }

    string parts[5];
    int partIndex = 0;
    string current = "";

    for (int i = 0; i < line.length(); i++)
    {
      if (line[i] == '|')
      {
        parts[partIndex] = current;
        partIndex++;
        current = "";
      }
      else
      {
        current += line[i];
      }
    }
    parts[partIndex] = current; // Last part

    // Create the record
    if (partIndex >= 4 && recordCount < MAX_RECORDS)
    {
      records[recordCount].studentId = parts[0];
      records[recordCount].courseCode = parts[1];
      records[recordCount].date = parts[2];
      records[recordCount].timeSlot = parts[3];
      records[recordCount].present = (parts[4] == "1");
      recordCount++;
    }
  }

  file.close();
}

// SEARCH or LOOKUP FUNCTIONS
// ========================================

int findStudentById(string id)
{
  for (int i = 0; i < studentCount; i++)
  {
    if (students[i].id == id)
    {
      return i;
    }
  }
  return -1; // Not found
}

int findCourseByCode(string code)
{
  for (int i = 0; i < courseCount; i++)
  {
    if (courses[i].code == code)
    {
      return i;
    }
  }
  return -1;
}

string getCourseTitle(string code)
{
  int index = findCourseByCode(code);
  if (index >= 0)
  {
    return courses[index].title;
  }
  return "Unknown";
}

// Check if attendance already exists for a student/course/date/time
bool attendanceExists(string studentId, string courseCode, string date,
                      string timeSlot)
{
  for (int i = 0; i < recordCount; i++)
  {
    if (records[i].studentId == studentId &&
        records[i].courseCode == courseCode && records[i].date == date &&
        records[i].timeSlot == timeSlot)
    {
      return true;
    }
  }
  return false;
}

int countAttendedClasses(string studentId, string courseCode)
{
  int count = 0;
  for (int i = 0; i < recordCount; i++)
  {
    if (records[i].studentId == studentId &&
        records[i].courseCode == courseCode && records[i].present)
    {
      count++;
    }
  }
  return count;
}

// Calculate attendance percentage
double calculateAttendancePercentage(string studentId, string courseCode)
{
  int courseIndex = findCourseByCode(courseCode);
  if (courseIndex < 0)
    return 0.0;

  int attended = countAttendedClasses(studentId, courseCode);
  int total = courses[courseIndex].totalClasses;

  if (total == 0)
    return 0.0;

  double percentage = (double(attended) / total) * 100.0;

  // Cap at 100%
  if (percentage > 100.0)
    percentage = 100.0;

  return percentage;
}

// DISPLAY FUNCTIONS
//-------------------------

void displayMainMenu()
{
  clearScreen();
  printDoubleLine();
  cout << "   ATTENDANCE TRACKING SYSTEM" << endl;
  cout << "   University Management System" << endl;
  printDoubleLine();
  cout << endl;
  cout << "   [1] Take Attendance" << endl;
  cout << "   [2] View Student Status" << endl;
  cout << "   [3] View Weekly Routine" << endl;
  cout << "   [4] Exit" << endl;
  cout << endl;
  printLine();
  cout << "Enter your choice: ";
}

// weekly routine
void viewRoutine()
{
  clearScreen();
  printDoubleLine();
  cout << "   WEEKLY CLASS ROUTINE" << endl;
  cout << "   Autumn 2025, Section 1AM" << endl;
  printDoubleLine();
  cout << endl;

  string days[] = {"Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"};
  int numDays = 5;

  // each day
  for (int d = 0; d < numDays; d++)
  {
    cout << "\n>> " << days[d] << ":" << endl;
    printLine();

    // Find and display classes for this day
    bool hasClasses = false;
    for (int i = 0; i < periodCount; i++)
    {
      if (routine[i].day == days[d])
      {
        hasClasses = true;
        cout << "   " << routine[i].startTime << " - " << routine[i].endTime
             << "  ->  " << routine[i].courseCode << " ("
             << getCourseTitle(routine[i].courseCode) << ")" << endl;
      }
    }

    if (!hasClasses)
    {
      cout << "   No classes" << endl;
    }
  }

  pauseScreen();
}

// TAKE ATTENDANCE FUNCTION

void takeAttendance()
{
  clearScreen();
  printDoubleLine();
  cout << "   TAKE ATTENDANCE" << endl;
  printDoubleLine();
  cout << endl;

  // Select day
  cout << "Select a day:" << endl;
  cout << "   [1] Saturday" << endl;
  cout << "   [2] Sunday" << endl;
  cout << "   [3] Monday" << endl;
  cout << "   [4] Tuesday" << endl;
  cout << "   [5] Wednesday" << endl;
  cout << "   [0] Back to Main Menu" << endl;
  cout << endl;
  cout << "Enter choice: ";

  int dayChoice;
  cin >> dayChoice;

  if (dayChoice == 0)
    return;
  if (dayChoice < 1 || dayChoice > 5)
  {
    cout << "Invalid choice!" << endl;
    pauseScreen();
    return;
  }

  string days[] = {"Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"};
  string selectedDay = days[dayChoice - 1];

  clearScreen();
  printDoubleLine();
  cout << "   CLASSES ON " << selectedDay << endl;
  printDoubleLine();
  cout << endl;

  // Store classes for this day in a temp array
  ClassPeriod dayClasses[10];
  int dayClassCount = 0;

  for (int i = 0; i < periodCount; i++)
  {
    if (routine[i].day == selectedDay && dayClassCount < 10)
    {
      dayClasses[dayClassCount] = routine[i];
      dayClassCount++;
    }
  }

  if (dayClassCount == 0)
  {
    cout << "No classes on " << selectedDay << "!" << endl;
    pauseScreen();
    return;
  }

  // Display class periods
  cout << "Select a class period:" << endl;
  for (int i = 0; i < dayClassCount; i++)
  {
    cout << "   [" << (i + 1) << "] " << dayClasses[i].startTime << " - "
         << dayClasses[i].endTime << "  " << dayClasses[i].courseCode << endl;
  }
  cout << "   [0] Back" << endl;
  cout << endl;
  cout << "Enter choice: ";

  int periodChoice;
  cin >> periodChoice;

  if (periodChoice == 0)
    return;
  if (periodChoice < 1 || periodChoice > dayClassCount)
  {
    cout << "Invalid choice!" << endl;
    pauseScreen();
    return;
  }

  // Get selected period
  ClassPeriod selectedPeriod = dayClasses[periodChoice - 1];

  // the date
  cout << endl;
  cout << "Enter date (DD-MM-YYYY) or press Enter for today ["
       << getCurrentDate() << "]: ";
  cin.ignore(); // buffer dur kore

  string dateInput;
  getline(cin, dateInput);

  if (dateInput.empty())
  {
    dateInput = getCurrentDate();
  }

  // date format
  if (dateInput.length() != 10 || dateInput[2] != '-' || dateInput[5] != '-')
  {
    cout << "Invalid date format! Please use DD-MM-YYYY" << endl;
    pauseScreen();
    return;
  }

  if (attendanceExists(students[0].id, selectedPeriod.courseCode, dateInput,
                       selectedPeriod.startTime))
  {
    cout << "Attendance already recorded for this date and period!" << endl;
    pauseScreen();
    return;
  }

  // Mark attendance
  clearScreen();
  printDoubleLine();
  cout << "   MARKING ATTENDANCE" << endl;
  printDoubleLine();
  cout << "Course: " << selectedPeriod.courseCode << " ("
       << getCourseTitle(selectedPeriod.courseCode) << ")" << endl;
  cout << "Date:   " << dateInput << endl;
  cout << "Time:   " << selectedPeriod.startTime << " - "
       << selectedPeriod.endTime << endl;
  printLine();
  cout << endl;

  cout << "Choose marking method:" << endl;
  cout << "   [1] Mark all PRESENT" << endl;
  cout << "   [2] Mark all ABSENT" << endl;
  cout << "   [3] Mark individually" << endl;
  cout << "   [0] Cancel" << endl;
  cout << endl;
  cout << "Enter choice: ";

  int markChoice;
  cin >> markChoice;

  if (markChoice == 0)
    return;

  if (markChoice == 1)
  {
    // Mark all present
    for (int i = 0; i < studentCount; i++)
    {
      if (recordCount < MAX_RECORDS)
      {
        records[recordCount].studentId = students[i].id;
        records[recordCount].courseCode = selectedPeriod.courseCode;
        records[recordCount].date = dateInput;
        records[recordCount].timeSlot = selectedPeriod.startTime;
        records[recordCount].present = true;
        recordCount++;
      }
    }
    cout << endl
         << "All students marked PRESENT!" << endl;
  }
  else if (markChoice == 2)
  {
    // Mark all absent
    for (int i = 0; i < studentCount; i++)
    {
      if (recordCount < MAX_RECORDS)
      {
        records[recordCount].studentId = students[i].id;
        records[recordCount].courseCode = selectedPeriod.courseCode;
        records[recordCount].date = dateInput;
        records[recordCount].timeSlot = selectedPeriod.startTime;
        records[recordCount].present = false;
        recordCount++;
      }
    }
    cout << endl
         << "All students marked ABSENT!" << endl;
  }
  else if (markChoice == 3)
  {
    // Mark individually
    cout << endl;
    cout << "Enter P for Present, A for Absent:" << endl;
    printLine();

    for (int i = 0; i < studentCount; i++)
    {
      char attendance;
      bool validInput = false;

      while (!validInput)
      {
        cout << setw(2) << students[i].sl << ". " << setw(10) << students[i].id
             << "  " << left << setw(35) << students[i].name << right
             << " [P/A]: ";

        cin >> attendance;

        // Convert to uppercase
        if (attendance >= 'a' && attendance <= 'z')
        {
          attendance = attendance - 32;
        }

        if (attendance == 'P' || attendance == 'A')
        {
          validInput = true;
        }
        else
        {
          cout << "   Invalid! Enter P or A only." << endl;
        }
      }

      // Add the record
      if (recordCount < MAX_RECORDS)
      {
        records[recordCount].studentId = students[i].id;
        records[recordCount].courseCode = selectedPeriod.courseCode;
        records[recordCount].date = dateInput;
        records[recordCount].timeSlot = selectedPeriod.startTime;
        records[recordCount].present = (attendance == 'P');
        recordCount++;
      }
    }
    cout << endl
         << "Attendance recorded successfully!" << endl;
  }
  else
  {
    cout << "Invalid choice!" << endl;
    pauseScreen();
    return;
  }

  // Save to file
  saveToFile();
  pauseScreen();
}

// VIEW STUDENT STATUS FUNCTION
// ============================

void viewStudentStatus()
{
  clearScreen();
  printDoubleLine();
  cout << "   STUDENT ATTENDANCE STATUS" << endl;
  printDoubleLine();
  cout << endl;

  cout << "Enter student ID (or 'ALL' to view everyone): ";
  string searchId;
  cin >> searchId;

  for (int i = 0; i < searchId.length(); i++)
  {
    if (searchId[i] >= 'a' && searchId[i] <= 'z')
    {
      searchId[i] = searchId[i] - 32;
    }
  }

  if (searchId == "ALL")
  {
    // Display all students
    clearScreen();
    printDoubleLine();
    cout << "   COMPLETE ATTENDANCE REPORT" << endl;
    printDoubleLine();
    cout << endl;

    // Print header
    cout << left << setw(4) << "SL" << setw(12) << "ID" << setw(30) << "Name";

    // Print course codes as headers
    for (int c = 0; c < courseCount; c++)
    {
      cout << setw(10) << courses[c].code.substr(0, 8);
    }
    cout << right << endl;
    printLine();

    // Print each student
    for (int i = 0; i < studentCount; i++)
    {
      cout << left << setw(4) << students[i].sl << setw(12) << students[i].id
           << setw(30) << students[i].name.substr(0, 28);

      for (int c = 0; c < courseCount; c++)
      {
        double percentage =
            calculateAttendancePercentage(students[i].id, courses[c].code);
        cout << setw(10) << fixed << setprecision(1) << percentage << "%";
      }
      cout << right << endl;
    }

    printLine();
    cout << endl;
    cout << "Note: Values show attendance percentage." << endl;
    cout << "      Below 60% = At risk of discollegiation" << endl;
  }
  else
  {
    //  specific student khujbo
    int studentIndex = findStudentById(searchId);

    if (studentIndex < 0)
    {
      cout << "Student not found!" << endl;
      pauseScreen();
      return;
    }

    // Display student info
    clearScreen();
    printDoubleLine();
    cout << "   STUDENT PROFILE" << endl;
    printDoubleLine();
    cout << endl;
    cout << "SL:   " << students[studentIndex].sl << endl;
    cout << "ID:   " << students[studentIndex].id << endl;
    cout << "Name: " << students[studentIndex].name << endl;
    printLine();
    cout << endl;

    cout << "ATTENDANCE SUMMARY:" << endl;
    cout << endl;
    cout << left << setw(15) << "Course" << setw(12) << "Attended" << setw(12)
         << "Total" << setw(15) << "Percentage"
         << "Status" << right << endl;
    printLine();

    for (int c = 0; c < courseCount; c++)
    {
      int attended =
          countAttendedClasses(students[studentIndex].id, courses[c].code);
      int total = courses[c].totalClasses;
      double percentage = calculateAttendancePercentage(
          students[studentIndex].id, courses[c].code);

      //  status
      string status;
      if (percentage >= 85)
      {
        status = "Excellent";
      }
      else if (percentage >= 70)
      {
        status = "Good";
      }
      else if (percentage >= 60)
      {
        status = "Warning";
      }
      else
      {
        status = "At Risk!";
      }

      cout << left << setw(15) << courses[c].code << setw(12) << attended
           << setw(12) << total << setw(15) << fixed << setprecision(1)
           << percentage << "%" << status << right << endl;
    }
  }

  pauseScreen();
}

// MAIN FUNCTION

int main()
{
  // Initialize all data first
  initializeStudents();
  initializeCourses();
  initializeRoutine();

  // Load any existing attendance data
  loadFromFile();

  // Main menu loop
  int choice;
  bool running = true;

  while (running)
  {
    displayMainMenu();
    cin >> choice;

    switch (choice)
    {
    case 1:
      takeAttendance();
      break;
    case 2:
      viewStudentStatus();
      break;
    case 3:
      viewRoutine();
      break;
    case 4:
      // Exit
      clearScreen();
      printDoubleLine();
      cout << "   SYSTEM SHUTDOWN" << endl;
      printDoubleLine();
      cout << endl;
      cout << "Thank you for using the Attendance System!" << endl;
      cout << "All data has been saved." << endl;
      cout << endl;
      running = false;
      break;
    default:
      cout << "Invalid choice! Please enter 1-4." << endl;
      pauseScreen();
      break;
    }
  }

  return 0;
}
