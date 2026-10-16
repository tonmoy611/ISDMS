import { Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppLayout from './components/AppLayout.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Verify from './pages/Verify.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Users from './pages/Users.jsx';
import UserForm from './pages/UserForm.jsx';
import UserDetail from './pages/UserDetail.jsx';
import Roles from './pages/Roles.jsx';
import Structure from './pages/Structure.jsx';
import Students from './pages/Students.jsx';
import StudentForm from './pages/StudentForm.jsx';
import StudentDetail from './pages/StudentDetail.jsx';
import MyProfile from './pages/MyProfile.jsx';
import Courses from './pages/Courses.jsx';
import CourseDetail from './pages/CourseDetail.jsx';
import MyCourses from './pages/MyCourses.jsx';
import Sections from './pages/Sections.jsx';
import SectionDetail from './pages/SectionDetail.jsx';
import MyRegistration from './pages/MyRegistration.jsx';
import StudentEnrollment from './pages/StudentEnrollment.jsx';
import EnrollmentList from './pages/EnrollmentList.jsx';
import MyClasses from './pages/MyClasses.jsx';
import AttendanceSection from './pages/AttendanceSection.jsx';
import AttendanceSession from './pages/AttendanceSession.jsx';
import AttendanceReport from './pages/AttendanceReport.jsx';
import MyAttendance from './pages/MyAttendance.jsx';
import StudentAttendance from './pages/StudentAttendance.jsx';
import ResultsHome from './pages/ResultsHome.jsx';
import ResultSheet from './pages/ResultSheet.jsx';
import MyResults from './pages/MyResults.jsx';
import StudentResults from './pages/StudentResults.jsx';
import MyDocuments from './pages/MyDocuments.jsx';
import StudentDocuments from './pages/StudentDocuments.jsx';
import DocumentsList from './pages/DocumentsList.jsx';
import DocumentViewer from './pages/DocumentViewer.jsx';
import VerifyDocument from './pages/VerifyDocument.jsx';
import FinanceHome from './pages/FinanceHome.jsx';
import InvoiceDetail from './pages/InvoiceDetail.jsx';
import StudentFinance from './pages/StudentFinance.jsx';
import MyFees from './pages/MyFees.jsx';

function PublicShell() {
  return (<><Navbar /><main id="main"><Landing /></main><Footer /></>);
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PublicShell />} />
      <Route path="/login" element={<Login />} />
      <Route path="/verify" element={<Verify />} />
      <Route path="/verify-document" element={<VerifyDocument />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/change-password" element={<ChangePassword />} />
          <Route element={<ProtectedRoute permission="users.view" />}>
            <Route path="/users" element={<Users />} />
            <Route path="/users/:id" element={<UserDetail />} />
          </Route>
          <Route element={<ProtectedRoute permission="users.create" />}>
            <Route path="/users/new" element={<UserForm />} />
          </Route>
          <Route element={<ProtectedRoute permission="students.view" />}>
            <Route path="/students" element={<Students />} />
            <Route path="/students/:id" element={<StudentDetail />} />
          </Route>
          <Route element={<ProtectedRoute permission="students.create" />}>
            <Route path="/students/new" element={<StudentForm />} />
          </Route>
          <Route element={<ProtectedRoute permission="courses.view" />}>
            <Route path="/courses" element={<Courses tab="courses" />} />
            <Route path="/courses/curriculum" element={<Courses tab="curriculum" />} />
            <Route path="/courses/credit-rules" element={<Courses tab="rules" />} />
            <Route path="/courses/:id" element={<CourseDetail />} />
          </Route>
          <Route element={<ProtectedRoute permission="sections.view" />}>
            <Route path="/sections" element={<Sections tab="sections" />} />
            <Route path="/sections/timetable" element={<Sections tab="timetable" />} />
            <Route path="/sections/rooms" element={<Sections tab="rooms" />} />
            <Route path="/sections/calendar" element={<Sections tab="calendar" />} />
            <Route path="/sections/:id" element={<SectionDetail />} />
          </Route>
          <Route path="/finance/invoices/:id" element={<InvoiceDetail />} />
          <Route element={<ProtectedRoute permission="finance.view" />}>
            <Route path="/finance" element={<FinanceHome tab="overview" />} />
            <Route path="/finance/invoices" element={<FinanceHome tab="invoices" />} />
            <Route path="/finance/payments" element={<FinanceHome tab="payments" />} />
            <Route path="/finance/setup" element={<FinanceHome tab="setup" />} />
            <Route path="/students/:id/finance" element={<StudentFinance />} />
          </Route>
          <Route path="/documents/:id" element={<DocumentViewer />} />
          <Route element={<ProtectedRoute permission="documents.view" />}>
            <Route path="/documents" element={<DocumentsList />} />
          </Route>
          <Route element={<ProtectedRoute permission="documents.issue" />}>
            <Route path="/students/:id/documents" element={<StudentDocuments />} />
          </Route>
          <Route path="/results" element={<ResultsHome tab="sections" />} />
          <Route path="/results/sections/:id" element={<ResultSheet />} />
          <Route element={<ProtectedRoute permission="results.approve" />}>
            <Route path="/results/corrections" element={<ResultsHome tab="corrections" />} />
          </Route>
          <Route element={<ProtectedRoute permission="results.view" />}>
            <Route path="/results/grade-scale" element={<ResultsHome tab="scale" />} />
            <Route path="/students/:id/results" element={<StudentResults />} />
          </Route>
          <Route path="/attendance/sections/:sectionId" element={<AttendanceSection />} />
          <Route path="/attendance/sessions/:id" element={<AttendanceSession />} />
          <Route element={<ProtectedRoute roles={['teacher']} />}>
            <Route path="/teaching" element={<MyClasses />} />
          </Route>
          <Route element={<ProtectedRoute permission="attendance.view" />}>
            <Route path="/attendance" element={<AttendanceReport />} />
            <Route path="/students/:id/attendance" element={<StudentAttendance />} />
          </Route>
          <Route element={<ProtectedRoute permission="enrollment.view" />}>
            <Route path="/enrollment" element={<EnrollmentList />} />
            <Route path="/students/:id/enrollment" element={<StudentEnrollment />} />
          </Route>
          <Route element={<ProtectedRoute roles={['student']} />}>
            <Route path="/registration" element={<MyRegistration />} />
            <Route path="/my-attendance" element={<MyAttendance />} />
            <Route path="/my-results" element={<MyResults />} />
            <Route path="/my-documents" element={<MyDocuments />} />
            <Route path="/my-fees" element={<MyFees />} />
            <Route path="/my-courses" element={<MyCourses />} />
            <Route path="/profile" element={<MyProfile />} />
          </Route>
          <Route element={<ProtectedRoute permission="structure.view" />}>
            <Route path="/structure" element={<Structure />} />
            <Route path="/structure/:resource" element={<Structure />} />
          </Route>
          <Route element={<ProtectedRoute permission="permissions.view" />}>
            <Route path="/roles" element={<Roles />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<PublicShell />} />
    </Routes>
  );
}
