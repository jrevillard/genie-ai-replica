package com.genieai.mobile.ui.screens.profile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.genieai.mobile.R
import com.genieai.mobile.ui.theme.*
import com.genieai.mobile.viewmodel.UserProfileViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UserProfileScreen(
    onNavigateBack: () -> Unit,
    profileViewModel: UserProfileViewModel = viewModel()
) {
    val uiState by profileViewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.saveSuccess) {
        if (uiState.saveSuccess) {
            snackbarHostState.showSnackbar("Profile saved successfully")
            profileViewModel.clearSaveSuccess()
        }
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let { snackbarHostState.showSnackbar(it) }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.user_profile_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
                actions = {
                    if (uiState.hasChanges) {
                        IconButton(onClick = { profileViewModel.saveProfile() }) {
                            Icon(Icons.Default.Save, contentDescription = stringResource(R.string.user_profile_save))
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Tab row
            ScrollableTabRow(
                selectedTabIndex = uiState.selectedTabIndex,
                edgePadding = Spacing.lg,
                divider = {}
            ) {
                UserProfileViewModel.PROFILE_TABS_SHORT.forEachIndexed { index, title ->
                    Tab(
                        selected = uiState.selectedTabIndex == index,
                        onClick = { profileViewModel.selectTab(index) },
                        text = { Text(title) }
                    )
                }
            }

            // Tab content
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(Spacing.lg)
            ) {
                Text(
                    text = UserProfileViewModel.PROFILE_TABS[uiState.selectedTabIndex],
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )

                when (uiState.selectedTabIndex) {
                    0 -> PersonalTab(profileViewModel)
                    1 -> GenericTab(profileViewModel, listOf("birthCert", "deathCert", "marriageDivorce", "adoption", "citizenship", "immigration"))
                    2 -> GenericTab(profileViewModel, listOf("currentAddress", "previousAddresses", "postalCode", "country", "residencyStatus"))
                    3 -> GenericTab(profileViewModel, listOf("idCard", "passport", "driversLicense", "voterId", "ssn"))
                    4 -> GenericTab(profileViewModel, listOf("medicalHistory", "vaccinations", "insuranceDetails", "disability", "bloodType"))
                    5 -> GenericTab(profileViewModel, listOf("eHistory", "currentEmployer", "workPermits", "certifications", "unemployment"))
                    6 -> GenericTab(profileViewModel, listOf("schools", "degrees", "performance", "scholarships"))
                    7 -> GenericTab(profileViewModel, listOf("incomeTax", "bankAccounts", "propertyTax", "businessTax"))
                    8 -> GenericTab(profileViewModel, listOf("pensionStatus", "childcare", "foodAssistance", "housingAssistance"))
                    9 -> GenericTab(profileViewModel, listOf("policeRecords", "courtCases", "finesPenalties", "paroleProbation"))
                    10 -> GenericTab(profileViewModel, listOf("vehicleReg", "trafficViolations", "licenseHistory", "publicTransportCard"))
                    11 -> GenericTab(profileViewModel, listOf("voterRegistration", "electionHistory", "partyMembership", "militaryStatus"))
                }
            }

            // Navigation buttons
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(Spacing.lg),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                if (uiState.selectedTabIndex > 0) {
                    OutlinedButton(
                        onClick = { profileViewModel.selectTab(uiState.selectedTabIndex - 1) }
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(Spacing.xs))
                        Text(stringResource(R.string.user_profile_previous))
                    }
                } else {
                    Spacer(modifier = Modifier.width(1.dp))
                }

                if (uiState.selectedTabIndex < 11) {
                    Button(
                        onClick = { profileViewModel.selectTab(uiState.selectedTabIndex + 1) },
                        colors = ButtonDefaults.buttonColors(containerColor = PrimaryBlue)
                    ) {
                        Text(stringResource(R.string.user_profile_next))
                        Spacer(modifier = Modifier.width(Spacing.xs))
                        Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, modifier = Modifier.size(18.dp))
                    }
                } else {
                    Button(
                        onClick = { profileViewModel.saveProfile() },
                        enabled = uiState.hasChanges && !uiState.isSaving,
                        colors = ButtonDefaults.buttonColors(containerColor = PrimaryBlue)
                    ) {
                        if (uiState.isSaving) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = NavbarText
                            )
                        } else {
                            Text(stringResource(R.string.user_profile_save))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PersonalTab(viewModel: UserProfileViewModel) {
    ProfileTextField(
        label = stringResource(R.string.user_profile_full_name),
        value = viewModel.getField("fullName"),
        onValueChange = { viewModel.updateField("fullName", it) }
    )
    ProfileTextField(
        label = stringResource(R.string.user_profile_dob),
        value = viewModel.getField("dob"),
        onValueChange = { viewModel.updateField("dob", it) }
    )
    ProfileTextField(
        label = stringResource(R.string.user_profile_gender),
        value = viewModel.getField("gender"),
        onValueChange = { viewModel.updateField("gender", it) }
    )
    ProfileTextField(
        label = stringResource(R.string.user_profile_nationality),
        value = viewModel.getField("nationality"),
        onValueChange = { viewModel.updateField("nationality", it) }
    )
    ProfileTextField(
        label = stringResource(R.string.user_profile_marital_status),
        value = viewModel.getField("maritalStatus"),
        onValueChange = { viewModel.updateField("maritalStatus", it) }
    )
}

@Composable
private fun GenericTab(viewModel: UserProfileViewModel, fields: List<String>) {
    for (field in fields) {
        ProfileTextField(
            label = field.replace(Regex("([A-Z])"), " $1").trim()
                .replaceFirstChar { it.uppercase() },
            value = viewModel.getField(field),
            onValueChange = { viewModel.updateField(field, it) }
        )
    }
}

@Composable
private fun ProfileTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radii.input),
        singleLine = true
    )
}
